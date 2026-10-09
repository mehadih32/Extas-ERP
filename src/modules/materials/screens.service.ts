import type {
  BillStatus,
  MaterialIssueKind,
  MeasurementUnit,
  PaymentType,
  Prisma,
  ProductionStatus,
  PurchaseOrderStatus,
  RawMaterialKind,
  RawMaterialMovementType,
} from "@prisma/client";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { listMoneyAccounts } from "@/modules/accounts/screens.service";
import type { CompanyContext } from "@/modules/auth/context";
import { getIssue, getProjectMaterials, listIssues } from "@/modules/materials/issue.service";
import {
  getMaterial,
  getMaterialsSummary,
  getStockCard,
  listMaterials,
  materialUses,
  openOrderLines,
} from "@/modules/materials/material.service";
import { getPurchaseOrder, listPurchaseOrders } from "@/modules/materials/purchase-order.service";
import { getPurchase, listPurchases } from "@/modules/materials/purchase.service";
import {
  canArchiveMaterial,
  canCancelOrder,
  canChangeOrder,
  canChangeOrderLines,
  canChangeUnit,
  canCloseOrder,
  canReactivateMaterial,
  canReceiveOnOrder,
  canReturnToSupplier,
  canStockIn,
  canVoidPurchase,
  canVoidSupplierReturn,
  materialsKeys,
} from "@/modules/materials/rules";
import {
  getSupplierReturn,
  listSupplierReturns,
} from "@/modules/materials/supplier-return.service";
import { formatQuantity, UNIT_LABELS, ZERO } from "@/modules/materials/valuation";
import { isWalkIn } from "@/modules/parties/walk-in";
import { canPayBill } from "@/modules/production/rules";
import { isProjectClosed } from "@/modules/production/project-costs";

/*
 * What the Raw materials screens show, as plain values (quantities as "120.5",
 * amounts as "12500.00", prices as "45.3750" strings, days as "2026-10-08" in
 * company time), with what the person looking may do decided by the same
 * permissions and rules the materials actions use (materials/rules.ts):
 *   materials.view      stock, stock cards, purchase orders, issue notes
 *   materials.manage    the store: counts, wastage, moving stock, issues
 *   materials.purchase  purchase orders, bills on credit, returns, opening stock
 *   accounts.payments.record  purchases paid now and paying bills
 * Prices and values reach only the people who may see them (seeCosts); the
 * services leave them out for everyone else.
 */

type Decimal = Prisma.Decimal;

/** "120.5": up to 3 decimals, without trailing zeros. */
const qty = (d: Decimal) => {
  const text = d.toFixed(3).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
};
/** "12500.00" */
const fixed = (d: Decimal) => d.toFixed(2);
/** "45.3750" → "45.375", "138.0000" → "138.00": at least 2 decimals. */
const price = (d: Decimal) => d.toFixed(4).replace(/(\.\d\d[1-9]?)0+$/, "$1");
const maybe = <T, R>(value: T | null, map: (v: T) => R): R | null =>
  value === null ? null : map(value);

const partyOf = (p: { id: string; code: string | null; name: string } | null) =>
  p ? { id: p.id, code: p.code ?? "", name: p.name } : null;

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

/** What this person may do anywhere in Raw materials (each screen narrows it to the record). */
export function materialsAccess(ctx: CompanyContext) {
  return {
    ...materialsKeys(ctx),
    /** Open a supplier's account (Buyers & suppliers). */
    openParty: ctx.can("parties.view"),
    /** Open a production project. */
    openProject: ctx.can("production.view"),
  };
}

type Access = ReturnType<typeof materialsAccess>;

/** The address of a document a stock card line or a record links to, when this person may open it. */
const href = {
  material: (id: string) => `/materials/stock/${id}`,
  order: (id: string) => `/materials/orders/${id}`,
  purchase: (id: string) => `/materials/purchases/${id}`,
  supplierReturn: (id: string) => `/materials/returns/${id}`,
  issue: (id: string) => `/materials/issues/${id}`,
  project: (id: string) => `/production/projects/${id}`,
};

/** The company's stores, the main one first. */
async function listStores(ctx: CompanyContext) {
  const rows = await ctx.db.warehouse.findMany({
    select: { id: true, name: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows;
}

export type StoreOption = Awaited<ReturnType<typeof listStores>>[number];

// =============================================================================
// Overview
// =============================================================================

/**
 * The Raw materials Overview: what the store holds by kind (and its value for
 * people who see costs), materials running low, what each store holds, and
 * purchase orders running late.
 */
export async function getOverviewScreen(ctx: CompanyContext) {
  const s = await getMaterialsSummary(ctx);
  const access = materialsAccess(ctx);
  const recent = await listIssues(ctx, { take: 5 });
  return {
    asOf: s.asOf,
    totals: {
      materials: s.totals.materials,
      inStock: s.totals.inStock,
      value: maybe(s.totals.value, fixed),
    },
    byKind: s.byKind.map((k) => ({
      kind: k.kind as RawMaterialKind,
      materials: k.materials,
      inStock: k.inStock,
      value: maybe(k.value, fixed),
    })),
    lowStock: s.lowStock.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      unit: m.unit,
      quantity: qty(m.quantity),
      reorderLevel: maybe(m.reorderLevel, qty),
      incoming: qty(m.incomingQuantity),
    })),
    stores: s.stores,
    orders: {
      open: s.purchaseOrders.open,
      partiallyReceived: s.purchaseOrders.partiallyReceived,
      overdue: s.purchaseOrders.overdue.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        supplier: partyOf(o.supplier),
        project: o.project,
        expectedOn: o.expectedDate,
        daysLate: o.daysLate,
      })),
    },
    recentNotes: recent.items.map((n) => ({
      id: n.id,
      number: n.number,
      kind: n.kind,
      day: localDay(n.date, ctx.company.timezone),
      project: n.project,
      store: n.warehouse.name,
      lineCount: n.lineCount,
    })),
    seeCosts: access.seeCosts,
    can: {
      addMaterial: access.catalogue,
      order: access.buy,
      receive: access.receive,
      issue: access.keepStore,
      seePurchases: access.seeCosts,
    },
  };
}

export type OverviewScreen = Awaited<ReturnType<typeof getOverviewScreen>>;

// =============================================================================
// Materials and their stock
// =============================================================================

type ListedMaterial = Awaited<ReturnType<typeof listMaterials>>["items"][number];

function presentMaterialRow(m: ListedMaterial) {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    kind: m.kind,
    unit: m.unit,
    color: m.color,
    /** In the store filtered on, or in every store. */
    quantity: qty(m.storeQuantity ?? m.quantity),
    reorderLevel: maybe(m.reorderLevel, qty),
    isLow: m.isLow,
    avgCost: maybe(m.avgCost, price),
    stockValue: maybe(m.stockValue, fixed),
    supplier: partyOf(m.supplier),
    isActive: m.isActive,
    incoming: qty(m.incomingQuantity),
    stores: m.stores,
  };
}

export type MaterialRow = ReturnType<typeof presentMaterialRow>;

export async function listMaterialRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listMaterials(ctx, raw);
  return { items: page.items.map(presentMaterialRow), nextCursor: page.nextCursor };
}

/** The Stock tab: the first page, the stores to filter by, and whether this person may add one. */
export async function getMaterialList(ctx: CompanyContext, raw: unknown = {}) {
  const access = materialsAccess(ctx);
  const [page, stores] = await Promise.all([listMaterialRows(ctx, raw), listStores(ctx)]);
  return {
    ...page,
    stores,
    seeCosts: access.seeCosts,
    canCreate: access.catalogue,
  };
}

export type MaterialList = Awaited<ReturnType<typeof getMaterialList>>;

/** Rows shown on screen from a stock card; older ones are left for narrower dates. */
export const CARD_LINES_SHOWN = 300;

const MOVEMENT_DOCUMENT_TYPES = ["BILL", "SUPPLIER_RETURN", "MATERIAL_ISSUE", "MATERIAL_RETURN"];

/**
 * One material: its details, what each store holds, what is on order, and its
 * stock card for the days (and store) chosen, with what this person may do.
 */
export async function getMaterialScreen(
  ctx: CompanyContext,
  materialId: string,
  query: { from?: string; to?: string; store?: string } = {},
) {
  const access = materialsAccess(ctx);
  const m = await getMaterial(ctx, materialId);
  const stores = await listStores(ctx);
  const store = query.store && stores.some((s) => s.id === query.store) ? query.store : undefined;
  const card = await getStockCard(ctx, materialId, {
    warehouseId: store,
    from: query.from,
    to: query.to,
  });
  const tz = ctx.company.timezone;
  const onHand = formatQuantity(m.quantity, m.unit);
  const archive =
    access.catalogue && m.isActive
      ? canArchiveMaterial({ ...m, onHand }, await openOrderLines(prisma, ctx.company.id, m.id))
      : null;
  const shown = card.lines.slice(-CARD_LINES_SHOWN);
  const held = m.stores.filter((s) => s.quantity.gt(0));

  return {
    today: today(ctx),
    material: {
      id: m.id,
      code: m.code,
      name: m.name,
      kind: m.kind,
      unit: m.unit,
      color: m.color,
      specification: m.specification,
      quantity: qty(m.quantity),
      reorderLevel: maybe(m.reorderLevel, qty),
      isLow: m.isLow,
      avgCost: maybe(m.avgCost, price),
      stockValue: maybe(m.stockValue, fixed),
      supplier: partyOf(m.supplier),
      isActive: m.isActive,
      notes: m.notes,
      stores: m.stores.map((s) => ({
        id: s.warehouse.id,
        name: s.warehouse.name,
        quantity: qty(s.quantity),
      })),
      incoming: qty(m.incomingQuantity),
      orders: m.incoming.map((o) => ({
        id: o.orderId,
        number: o.number,
        status: o.status,
        supplier: partyOf(o.supplier),
        orderedOn: o.orderDate,
        expectedOn: o.expectedDate,
        ordered: qty(o.ordered),
        received: qty(o.received),
        pending: qty(o.pending),
        unitPrice: maybe(o.unitPrice, price),
      })),
    },
    stores,
    card: {
      store: card.warehouse,
      from: query.from ?? null,
      to: query.to ?? null,
      opening: { quantity: qty(card.opening.quantity), value: maybe(card.opening.value, fixed) },
      closing: { quantity: qty(card.closing.quantity), value: maybe(card.closing.value, fixed) },
      totalIn: qty(card.lines.reduce((t, l) => (l.quantity.gt(0) ? t.plus(l.quantity) : t), ZERO)),
      totalOut: qty(
        card.lines.reduce((t, l) => (l.quantity.lt(0) ? t.minus(l.quantity) : t), ZERO),
      ),
      lineCount: card.lines.length,
      hiddenCount: card.lines.length - shown.length,
      /** More than the server reads at once (2,000 lines): choose fewer days. */
      cutShort: card.hasMore,
      lines: shown.map((l) => {
        const doc = l.document;
        const docHref =
          doc === null || !MOVEMENT_DOCUMENT_TYPES.includes(doc.type)
            ? null
            : doc.type === "BILL"
              ? access.seeCosts
                ? href.purchase(doc.id)
                : null
              : doc.type === "SUPPLIER_RETURN"
                ? access.seeCosts
                  ? href.supplierReturn(doc.id)
                  : null
                : href.issue(doc.id);
        return {
          id: l.id,
          day: localDay(l.date, tz),
          type: l.type,
          store: l.warehouse.name,
          otherStore: l.otherStore?.name ?? null,
          quantity: qty(l.quantity),
          unitCost: maybe(l.unitCost, price),
          value: maybe(l.value, fixed),
          balance: qty(l.balance),
          balanceValue: maybe(l.balanceValue, fixed),
          document: doc ? { number: doc.number, href: docHref } : null,
          supplier: doc && doc.type === "BILL" ? (doc.supplier?.name ?? null) : null,
          project: l.project
            ? {
                code: l.project.code,
                href: access.openProject ? href.project(l.project.id) : null,
              }
            : null,
          note: l.note,
          by: l.createdBy?.name ?? null,
        };
      }),
    },
    seeCosts: access.seeCosts,
    can: {
      edit: access.catalogue,
      archive: archive?.ok ?? false,
      reactivate: access.catalogue && canReactivateMaterial(m).ok,
      openingStock: access.openingStock && canStockIn(m).ok,
      count: access.keepStore && m.isActive,
      wastage: access.keepStore && held.length > 0,
      transfer: access.keepStore && held.length > 0 && stores.length > 1,
      order: access.buy && m.isActive,
      receive: access.receive && m.isActive,
      issue: access.keepStore && held.length > 0,
      openParty: access.openParty,
    },
    notes: {
      archive: archive && !archive.ok ? archive.message : null,
    },
  };
}

export type MaterialScreen = Awaited<ReturnType<typeof getMaterialScreen>>;

/** The material form: the kinds and units, and for a change the material as it is. */
export async function getMaterialForm(ctx: CompanyContext, materialId?: string) {
  if (!materialId) return { material: null, unitLocked: null };
  const m = await getMaterial(ctx, materialId);
  const unitVerdict = canChangeUnit(
    { code: m.code, unitLabel: UNIT_LABELS[m.unit] },
    await materialUses(prisma, m.id),
  );
  return {
    material: {
      id: m.id,
      code: m.code,
      name: m.name,
      kind: m.kind,
      unit: m.unit,
      color: m.color ?? "",
      specification: m.specification ?? "",
      reorderLevel: m.reorderLevel ? qty(m.reorderLevel) : "",
      supplier: partyOf(m.supplier),
      notes: m.notes ?? "",
      isActive: m.isActive,
    },
    /** Why the unit can no longer change, or null. */
    unitLocked: unitVerdict.ok ? null : unitVerdict.message,
  };
}

export type MaterialForm = Awaited<ReturnType<typeof getMaterialForm>>;

// =============================================================================
// Pickers
// =============================================================================

/**
 * Materials in use to put on an order, a bill or an issue note: what each
 * holds in every store, and (for people who see costs) its average cost.
 */
export async function findMaterials(ctx: CompanyContext, query: { search?: string } = {}) {
  const search = (query.search ?? "").trim().slice(0, 100);
  const page = await listMaterials(ctx, { search: search || undefined, take: 20 });
  const stocks = await ctx.db.rawMaterialStock.findMany({
    where: { rawMaterialId: { in: page.items.map((m) => m.id) }, quantity: { gt: 0 } },
    select: { rawMaterialId: true, warehouseId: true, quantity: true },
  });
  return page.items.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    kind: m.kind,
    unit: m.unit,
    quantity: qty(m.quantity),
    avgCost: maybe(m.avgCost, price),
    /** On hand in each store that holds some. */
    stores: stocks
      .filter((s) => s.rawMaterialId === m.id)
      .map((s) => ({ id: s.warehouseId, quantity: qty(s.quantity) })),
  }));
}

export type MaterialOption = Awaited<ReturnType<typeof findMaterials>>[number];

/** Suppliers to order from or buy from (open accounts; Walk-in customers is never one). */
export async function findSuppliers(ctx: CompanyContext, query: { search?: string } = {}) {
  const search = (query.search ?? "").trim().slice(0, 100);
  const rows = await ctx.db.party.findMany({
    where: {
      kind: { in: ["SUPPLIER", "BOTH"] },
      status: { in: ["ACTIVE", "DORMANT"] },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
              { contactPerson: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 21,
  });
  return rows
    .filter((p) => !isWalkIn(p))
    .slice(0, 20)
    .map((p) => ({ id: p.id, code: p.code, name: p.name, phone: p.phone, city: p.city }));
}

export type SupplierOption = Awaited<ReturnType<typeof findSuppliers>>[number];

const OPEN_PROJECT: ProductionStatus[] = ["PLANNED", "ACTIVE", "ON_HOLD"];

/** Open production projects (planned, running or on hold) to issue to or order for. */
export async function findProjects(ctx: CompanyContext, query: { search?: string } = {}) {
  const search = (query.search ?? "").trim().slice(0, 100);
  const rows = await ctx.db.productionProject.findMany({
    where: {
      status: { in: OPEN_PROJECT },
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { buyer: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { buyer: { select: { name: true } } },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    take: 20,
  });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    buyerLabel: p.buyer?.name ?? "In-House",
  }));
}

export type ProjectOption = Awaited<ReturnType<typeof findProjects>>[number];

// =============================================================================
// Purchase orders
// =============================================================================

type ListedOrder = Awaited<ReturnType<typeof listPurchaseOrders>>["items"][number];

function presentOrderRow(o: ListedOrder) {
  const lines = o.lines.length;
  const arrived = o.lines.filter((l) => l.receivedQty.gte(l.quantity)).length;
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    supplier: partyOf(o.supplier),
    project: o.project ? { id: o.project.id, code: o.project.code } : null,
    orderedOn: o.orderDate,
    expectedOn: o.expectedDate,
    isOverdue: o.isOverdue,
    supplierRef: o.supplierRef,
    total: maybe(o.totalAmount, fixed),
    lineCount: lines,
    /** Lines that have fully arrived. */
    arrivedCount: arrived,
    /** "FAB-0001, TRM-0002 and 1 more" */
    materials: o.lines.map((l) => l.material.code),
  };
}

export type OrderRow = ReturnType<typeof presentOrderRow>;

export async function listOrderRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listPurchaseOrders(ctx, raw);
  return { items: page.items.map(presentOrderRow), nextCursor: page.nextCursor };
}

/** The Purchase orders tab: the first page, and whether this person may raise one. */
export async function getOrderList(
  ctx: CompanyContext,
  raw: { supplierId?: string; materialId?: string } & Record<string, unknown> = {},
) {
  const access = materialsAccess(ctx);
  const page = await listOrderRows(ctx, raw);
  const supplier = raw.supplierId
    ? await ctx.db.party.findUnique({
        where: { id: raw.supplierId },
        select: { id: true, code: true, name: true },
      })
    : null;
  const material = raw.materialId
    ? await ctx.db.rawMaterial.findUnique({
        where: { id: raw.materialId },
        select: { id: true, code: true, name: true },
      })
    : null;
  return {
    ...page,
    supplier: partyOf(supplier),
    material,
    seeCosts: access.seeCosts,
    canCreate: access.buy,
  };
}

export type OrderList = Awaited<ReturnType<typeof getOrderList>>;

/**
 * One purchase order: its lines and what has arrived on each, the bills the
 * goods came on, and what this person may do with it.
 */
export async function getOrderScreen(ctx: CompanyContext, orderId: string) {
  const access = materialsAccess(ctx);
  const o = await getPurchaseOrder(ctx, orderId);
  const tz = ctx.company.timezone;
  const state = {
    number: o.number,
    status: o.status,
    received: o.lines.some((l) => l.receivedQty.gt(0)),
  };
  return {
    order: {
      id: o.id,
      number: o.number,
      status: o.status,
      supplier: { ...partyOf(o.supplier)!, phone: o.supplier.phone },
      project: o.project
        ? {
            id: o.project.id,
            code: o.project.code,
            name: o.project.name,
            href: access.openProject ? href.project(o.project.id) : null,
          }
        : null,
      orderedOn: o.orderDate,
      expectedOn: o.expectedDate,
      isOverdue: o.isOverdue,
      supplierRef: o.supplierRef,
      total: maybe(o.totalAmount, fixed),
      notes: o.notes,
      closedReason: o.closedReason,
      closedOn: o.closedAt ? localDay(o.closedAt, tz) : null,
      createdBy: o.createdBy?.name ?? null,
      lines: o.lines.map((l) => ({
        id: l.id,
        material: { id: l.material.id, code: l.material.code, name: l.material.name },
        unit: l.material.unit,
        quantity: qty(l.quantity),
        received: qty(l.receivedQty),
        pending: qty(l.pending),
        unitPrice: maybe(l.unitPrice, price),
        amount: maybe(l.amount, fixed),
        description: l.description,
      })),
      bills: o.bills.map((b) => ({
        id: b.id,
        number: b.number,
        billOn: localDay(b.billDate, tz),
        status: b.status,
        supplierRef: b.supplierRef,
        total: maybe(b.totalAmount, fixed),
        href: access.seeCosts ? href.purchase(b.id) : null,
      })),
    },
    seeCosts: access.seeCosts,
    can: {
      edit: access.buy && canChangeOrder(state).ok,
      editLines: access.buy && canChangeOrderLines(state).ok,
      cancel: access.buy && canCancelOrder(state).ok,
      close: access.buy && canCloseOrder(state).ok,
      receive: access.receive && canReceiveOnOrder(state).ok,
      openParty: access.openParty,
    },
  };
}

export type OrderScreen = Awaited<ReturnType<typeof getOrderScreen>>;

/**
 * The purchase order form: today, and either the order to change (its lines
 * only while nothing has arrived) or a new one, started from a material, a
 * supplier or a project when given.
 */
export async function getOrderForm(
  ctx: CompanyContext,
  options: { orderId?: string; materialId?: string; supplierId?: string; projectId?: string } = {},
) {
  const base = { today: today(ctx) };
  if (options.orderId) {
    const o = await getPurchaseOrder(ctx, options.orderId);
    const state = {
      number: o.number,
      status: o.status,
      received: o.lines.some((l) => l.receivedQty.gt(0)),
    };
    const change = canChangeOrder(state);
    if (!change.ok) throw new AppError(change.code, change.message);
    const locked = canChangeOrderLines(state);
    return {
      ...base,
      order: {
        id: o.id,
        number: o.number,
        orderedOn: o.orderDate,
        expectedOn: o.expectedDate ?? "",
        supplierRef: o.supplierRef ?? "",
        notes: o.notes ?? "",
      },
      supplier: partyOf(o.supplier),
      project: o.project ? { id: o.project.id, code: o.project.code, name: o.project.name } : null,
      lines: o.lines.map((l) => ({
        material: {
          id: l.material.id,
          code: l.material.code,
          name: l.material.name,
          unit: l.material.unit,
        },
        quantity: qty(l.quantity),
        unitPrice: l.unitPrice ? price(l.unitPrice) : "",
        description: l.description ?? "",
      })),
      /** Why its lines can no longer change, or null. */
      linesLocked: locked.ok ? null : locked.message,
    };
  }
  const [material, supplier, project] = await Promise.all([
    options.materialId
      ? ctx.db.rawMaterial.findFirst({
          where: { id: options.materialId, isActive: true },
          select: { id: true, code: true, name: true, unit: true, supplierId: true },
        })
      : null,
    options.supplierId
      ? ctx.db.party.findFirst({
          where: {
            id: options.supplierId,
            kind: { in: ["SUPPLIER", "BOTH"] },
            status: { in: ["ACTIVE", "DORMANT"] },
          },
          select: { id: true, code: true, name: true },
        })
      : null,
    options.projectId
      ? ctx.db.productionProject.findFirst({
          where: { id: options.projectId, status: { in: OPEN_PROJECT } },
          select: { id: true, code: true, name: true },
        })
      : null,
  ]);
  // A material's usual supplier is the first guess for whom to order it from.
  const usual =
    !supplier && material?.supplierId
      ? await ctx.db.party.findFirst({
          where: { id: material.supplierId, status: { in: ["ACTIVE", "DORMANT"] } },
          select: { id: true, code: true, name: true },
        })
      : null;
  return {
    ...base,
    order: null,
    supplier: partyOf(supplier ?? usual),
    project,
    lines: material
      ? [
          {
            material: {
              id: material.id,
              code: material.code,
              name: material.name,
              unit: material.unit,
            },
            quantity: "",
            unitPrice: "",
            description: "",
          },
        ]
      : [],
    linesLocked: null,
  };
}

export type OrderForm = Awaited<ReturnType<typeof getOrderForm>>;

// =============================================================================
// Purchases (supplier bills for materials)
// =============================================================================

type ListedPurchase = Awaited<ReturnType<typeof listPurchases>>["items"][number];

function presentPurchaseRow(b: ListedPurchase, tz: string) {
  return {
    id: b.id,
    number: b.number,
    supplier: partyOf(b.supplier),
    supplierRef: b.supplierRef,
    billOn: localDay(b.billDate, tz),
    status: b.status as BillStatus,
    paymentType: b.paymentType as PaymentType,
    total: fixed(b.totalAmount),
    paid: fixed(b.paidAmount),
    due: fixed(b.dueAmount),
    store: b.warehouse?.name ?? null,
    order: b.purchaseOrder ? { id: b.purchaseOrder.id, number: b.purchaseOrder.number } : null,
    lineCount: b._count.items,
  };
}

export type PurchaseRow = ReturnType<typeof presentPurchaseRow>;

export async function listPurchaseRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listPurchases(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((b) => presentPurchaseRow(b, tz)), nextCursor: page.nextCursor };
}

/** The Purchases tab: the first page, and whether this person may record one. */
export async function getPurchaseList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listPurchaseRows(ctx, raw)), canCreate: materialsAccess(ctx).receive };
}

export type PurchaseList = Awaited<ReturnType<typeof getPurchaseList>>;

/**
 * One purchase: the materials that came in (and how much of each went back),
 * what was paid, the returns made from it, and paying, voiding or sending
 * goods back as this person may.
 */
export async function getPurchaseScreen(ctx: CompanyContext, billId: string) {
  const access = materialsAccess(ctx);
  const b = await getPurchase(ctx, billId);
  const tz = ctx.company.timezone;
  const activeReturns = b.purchaseReturns.filter((r) => !r.voidedAt).map((r) => r.number);
  const returnable = b.items.reduce((t, i) => t.plus(i.returnableQty), ZERO);
  const voiding = access.undo ? canVoidPurchase({ ...b, activeReturns }) : null;
  const pay = access.pay && canPayBill(b).ok;
  return {
    today: today(ctx),
    bill: {
      id: b.id,
      number: b.number,
      supplier: { ...partyOf(b.supplier)!, phone: b.supplier.phone },
      supplierRef: b.supplierRef,
      billOn: localDay(b.billDate, tz),
      status: b.status,
      paymentType: b.paymentType,
      total: fixed(b.totalAmount),
      paid: fixed(b.paidAmount),
      due: fixed(b.dueAmount),
      notes: b.notes,
      store: b.warehouse?.name ?? null,
      order: b.purchaseOrder
        ? {
            id: b.purchaseOrder.id,
            number: b.purchaseOrder.number,
            href: href.order(b.purchaseOrder.id),
          }
        : null,
      attachment: b.attachment ? { id: b.attachment.id, fileName: b.attachment.fileName } : null,
      items: b.items.map((i) => ({
        id: i.id,
        material: { id: i.rawMaterial.id, code: i.rawMaterial.code, name: i.rawMaterial.name },
        unit: i.rawMaterial.unit,
        quantity: qty(i.quantity),
        unitPrice: price(i.unitPrice),
        amount: fixed(i.amount),
        returned: qty(i.returnedQty),
        returnable: qty(i.returnableQty),
        description: i.description,
      })),
      payments: b.payments.map((p) => ({
        id: p.id,
        number: p.number,
        amount: fixed(p.amount),
        method: p.method,
        paidOn: localDay(p.paymentDate, tz),
        reference: p.reference,
        account: p.account?.name ?? null,
      })),
      returns: b.purchaseReturns.map((r) => ({
        id: r.id,
        number: r.number,
        day: localDay(r.date, tz),
        reason: r.reason,
        total: fixed(r.totalAmount),
        isVoid: r.voidedAt !== null,
      })),
    },
    /** Where a payment can come from (Accounts only). */
    moneyAccounts: pay ? await listMoneyAccounts(ctx) : [],
    can: {
      pay,
      void: voiding?.ok ?? false,
      return:
        access.undo && canReturnToSupplier({ number: b.number, status: b.status, returnable }).ok,
      openParty: access.openParty,
    },
    notes: {
      void: voiding && !voiding.ok && b.status !== "VOID" ? voiding.message : null,
    },
  };
}

export type PurchaseScreen = Awaited<ReturnType<typeof getPurchaseScreen>>;

/**
 * The purchase form: today, the stores, how it may be paid (Due always; paid
 * now for Accounts, with the accounts it can come from) and, when the goods
 * arrive on a purchase order, the order with what is still to come.
 */
export async function getPurchaseForm(ctx: CompanyContext, options: { orderId?: string } = {}) {
  const access = materialsAccess(ctx);
  const stores = await listStores(ctx);
  let order = null;
  if (options.orderId) {
    const o = await getPurchaseOrder(ctx, options.orderId);
    const receiving = canReceiveOnOrder({ number: o.number, status: o.status, received: false });
    if (!receiving.ok) throw new AppError(receiving.code, receiving.message);
    order = {
      id: o.id,
      number: o.number,
      supplier: partyOf(o.supplier)!,
      project: o.project ? { id: o.project.id, code: o.project.code } : null,
      lines: o.lines
        .filter((l) => l.pending.gt(0))
        .map((l) => ({
          id: l.id,
          material: {
            id: l.material.id,
            code: l.material.code,
            name: l.material.name,
            unit: l.material.unit,
          },
          ordered: qty(l.quantity),
          pending: qty(l.pending),
          unitPrice: l.unitPrice ? price(l.unitPrice) : "",
        })),
    };
  }
  return {
    today: today(ctx),
    stores,
    defaultStoreId: stores.find((s) => s.isDefault)?.id ?? stores[0]?.id ?? "",
    canPayNow: access.pay,
    moneyAccounts: access.pay ? await listMoneyAccounts(ctx) : [],
    order,
  };
}

export type PurchaseForm = Awaited<ReturnType<typeof getPurchaseForm>>;

// =============================================================================
// Returns to suppliers
// =============================================================================

type ListedReturn = Awaited<ReturnType<typeof listSupplierReturns>>["items"][number];

function presentReturnRow(r: ListedReturn, tz: string) {
  return {
    id: r.id,
    number: r.number,
    supplier: partyOf(r.supplier),
    bill: { id: r.bill.id, number: r.bill.number },
    day: localDay(r.date, tz),
    reason: r.reason,
    total: fixed(r.totalAmount),
    store: r.warehouse.name,
    lineCount: r._count.lines,
    isVoid: r.voidedAt !== null,
  };
}

export type ReturnRow = ReturnType<typeof presentReturnRow>;

export async function listReturnRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listSupplierReturns(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((r) => presentReturnRow(r, tz)), nextCursor: page.nextCursor };
}

/** The Supplier returns tab (void ones included, marked). */
export async function getReturnList(ctx: CompanyContext, raw: Record<string, unknown> = {}) {
  return { ...(await listReturnRows(ctx, { ...raw, includeVoid: true })) };
}

export type ReturnList = Awaited<ReturnType<typeof getReturnList>>;

/** One return to a supplier: what went back from which bill, and voiding it. */
export async function getReturnScreen(ctx: CompanyContext, returnId: string) {
  const access = materialsAccess(ctx);
  const r = await getSupplierReturn(ctx, returnId);
  const tz = ctx.company.timezone;
  const isVoid = r.voidedAt !== null;
  return {
    ret: {
      id: r.id,
      number: r.number,
      supplier: partyOf(r.supplier)!,
      bill: {
        id: r.bill.id,
        number: r.bill.number,
        supplierRef: r.bill.supplierRef,
        billOn: localDay(r.bill.billDate, tz),
      },
      day: localDay(r.date, tz),
      reason: r.reason,
      store: r.warehouse.name,
      total: fixed(r.totalAmount),
      isVoid,
      voidedOn: r.voidedAt ? localDay(r.voidedAt, tz) : null,
      voidReason: r.voidReason,
      createdBy: r.createdBy?.name ?? null,
      lines: r.lines.map((l) => ({
        id: l.id,
        material: { id: l.rawMaterial.id, code: l.rawMaterial.code, name: l.rawMaterial.name },
        unit: l.rawMaterial.unit,
        quantity: qty(l.quantity),
        unitPrice: price(l.unitPrice),
        amount: fixed(l.amount),
      })),
    },
    can: {
      void: access.undo && canVoidSupplierReturn({ number: r.number, isVoid }).ok,
      openParty: access.openParty,
    },
  };
}

export type ReturnScreen = Awaited<ReturnType<typeof getReturnScreen>>;

/** Sending goods back from a bill: its lines with what can still go back, and the stores. */
export async function getReturnForm(ctx: CompanyContext, billId: string) {
  const b = await getPurchase(ctx, billId);
  const returnable = b.items.reduce((t, i) => t.plus(i.returnableQty), ZERO);
  const verdict = canReturnToSupplier({ number: b.number, status: b.status, returnable });
  if (!verdict.ok) throw new AppError(verdict.code, verdict.message);
  const stores = await listStores(ctx);
  return {
    today: today(ctx),
    stores,
    bill: {
      id: b.id,
      number: b.number,
      supplier: partyOf(b.supplier)!,
      supplierRef: b.supplierRef,
      billOn: localDay(b.billDate, ctx.company.timezone),
      storeId: b.warehouseId ?? stores[0]?.id ?? "",
      lines: b.items
        .filter((i) => i.returnableQty.gt(0))
        .map((i) => ({
          id: i.id,
          material: { id: i.rawMaterial.id, code: i.rawMaterial.code, name: i.rawMaterial.name },
          unit: i.rawMaterial.unit,
          quantity: qty(i.quantity),
          returnable: qty(i.returnableQty),
          unitPrice: price(i.unitPrice),
        })),
    },
  };
}

export type ReturnForm = Awaited<ReturnType<typeof getReturnForm>>;

// =============================================================================
// Issues to production and returns from it
// =============================================================================

type ListedIssue = Awaited<ReturnType<typeof listIssues>>["items"][number];

function presentIssueRow(n: ListedIssue, tz: string) {
  return {
    id: n.id,
    number: n.number,
    kind: n.kind,
    day: localDay(n.date, tz),
    project: n.project,
    store: n.warehouse.name,
    receivedBy: n.receivedBy,
    total: maybe(n.totalValue, fixed),
    lineCount: n.lineCount,
  };
}

export type IssueRow = ReturnType<typeof presentIssueRow>;

export async function listIssueRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listIssues(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((n) => presentIssueRow(n, tz)), nextCursor: page.nextCursor };
}

/** The Issue notes tab: the first page, and whether this person may issue or take back. */
export async function getIssueList(
  ctx: CompanyContext,
  raw: { projectId?: string } & Record<string, unknown> = {},
) {
  const access = materialsAccess(ctx);
  const project = raw.projectId
    ? await ctx.db.productionProject.findUnique({
        where: { id: raw.projectId },
        select: { id: true, code: true, name: true },
      })
    : null;
  return {
    ...(await listIssueRows(ctx, raw)),
    project,
    seeCosts: access.seeCosts,
    canIssue: access.keepStore,
  };
}

export type IssueList = Awaited<ReturnType<typeof getIssueList>>;

/** One issue or return note: its project, store and lines. Notes are not voided. */
export async function getIssueScreen(ctx: CompanyContext, issueId: string) {
  const access = materialsAccess(ctx);
  const n = await getIssue(ctx, issueId);
  const tz = ctx.company.timezone;
  const open = !isProjectClosed(n.project);
  return {
    note: {
      id: n.id,
      number: n.number,
      kind: n.kind,
      day: localDay(n.date, tz),
      project: {
        id: n.project.id,
        code: n.project.code,
        name: n.project.name,
        status: n.project.status,
        href: access.openProject ? href.project(n.project.id) : null,
      },
      store: n.warehouse.name,
      receivedBy: n.receivedBy,
      note: n.note,
      total: maybe(n.totalValue, fixed),
      createdBy: n.createdBy?.name ?? null,
      lines: n.lines.map((l) => ({
        material: { id: l.material.id, code: l.material.code, name: l.material.name },
        unit: l.material.unit,
        quantity: qty(l.quantity),
        unitCost: maybe(l.unitCost, price),
        value: maybe(l.value, fixed),
      })),
    },
    seeCosts: access.seeCosts,
    can: {
      /** Correct a mistaken issue with a return, and the other way round. */
      correct: access.keepStore && open,
    },
  };
}

export type IssueScreen = Awaited<ReturnType<typeof getIssueScreen>>;

/** What a project still holds of each material (issued less returned), for a return note. */
async function projectHoldings(ctx: CompanyContext, projectId: string) {
  const { materials } = await getProjectMaterials(ctx, projectId);
  return materials
    .filter((m) => m.netQuantity.gt(0))
    .map((m) => ({
      material: {
        id: m.material.id,
        code: m.material.code,
        name: m.material.name,
        unit: m.material.unit,
      },
      holding: qty(m.netQuantity),
    }));
}

/**
 * The issue or return note form: the stores, the project when one is given
 * (any open project) and, for a return, what that project still holds.
 */
export async function getIssueForm(
  ctx: CompanyContext,
  options: { kind: MaterialIssueKind; projectId?: string },
) {
  const stores = await listStores(ctx);
  const project = options.projectId
    ? await ctx.db.productionProject.findFirst({
        where: { id: options.projectId, status: { in: OPEN_PROJECT } },
        include: { buyer: { select: { name: true } } },
      })
    : null;
  return {
    kind: options.kind,
    today: today(ctx),
    stores,
    defaultStoreId: stores.find((s) => s.isDefault)?.id ?? stores[0]?.id ?? "",
    project: project
      ? {
          id: project.id,
          code: project.code,
          name: project.name,
          status: project.status,
          buyerLabel: project.buyer?.name ?? "In-House",
        }
      : null,
    holdings: project && options.kind === "RETURN" ? await projectHoldings(ctx, project.id) : [],
  };
}

export type IssueForm = Awaited<ReturnType<typeof getIssueForm>>;

/** What a project still holds, when the return form's project changes. */
export async function getProjectHoldings(ctx: CompanyContext, projectId: string) {
  return projectHoldings(ctx, projectId);
}

export type ProjectHolding = Awaited<ReturnType<typeof getProjectHoldings>>[number];

// =============================================================================
// A production project's materials (shown on its Production page)
// =============================================================================

/**
 * The materials a production project received from the store and gave back,
 * its issue and return notes, and purchase orders still due for it. Values
 * show to people who see costs; the notes open for people who see Raw materials.
 */
export async function getProjectMaterialsPanel(ctx: CompanyContext, projectId: string) {
  const access = materialsAccess(ctx);
  const p = await getProjectMaterials(ctx, projectId);
  const tz = ctx.company.timezone;
  const open = !isProjectClosed(p.project);
  return {
    project: { id: p.project.id, code: p.project.code, status: p.project.status },
    materials: p.materials.map((m) => ({
      material: {
        id: m.material.id,
        code: m.material.code,
        name: m.material.name,
        href: access.view ? href.material(m.material.id) : null,
      },
      unit: m.material.unit as MeasurementUnit,
      issued: qty(m.issuedQuantity),
      returned: qty(m.returnedQuantity),
      held: qty(m.netQuantity),
      value: maybe(m.netValue, fixed),
    })),
    materialCost: maybe(p.materialCost, fixed),
    /** Newest first. */
    notes: [...p.notes].reverse().map((n) => ({
      id: n.id,
      number: n.number,
      kind: n.kind,
      day: localDay(n.date, tz),
      store: n.warehouse.name,
      receivedBy: n.receivedBy,
      href: access.view ? href.issue(n.id) : null,
    })),
    orders: p.purchaseOrders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status as PurchaseOrderStatus,
      supplier: partyOf(o.supplier),
      expectedOn: o.expectedDate,
      href: access.view ? href.order(o.id) : null,
      lines: o.lines.map((l) => ({
        code: l.material.code,
        unit: l.material.unit,
        pending: qty(l.pending),
      })),
    })),
    seeCosts: access.seeCosts,
    can: {
      issue: access.keepStore && open,
      takeBack: access.keepStore && open && p.materials.some((m) => m.netQuantity.gt(0)),
      order: access.buy && open,
    },
  };
}

export type ProjectMaterialsPanel = Awaited<ReturnType<typeof getProjectMaterialsPanel>>;

export type MaterialsAccess = Access;
export type MovementType = RawMaterialMovementType;
