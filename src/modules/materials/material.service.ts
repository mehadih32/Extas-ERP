import { randomUUID } from "node:crypto";

import { Prisma, type PurchaseOrderStatus, type RawMaterial } from "@prisma/client";

import { dateColumn, dateOnly, dayRange, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { type JournalLineInput, postJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertAnyPermission, assertCanKeepStore, costMask } from "@/modules/materials/access";
import {
  countStockSchema,
  createMaterialSchema,
  listMaterialsSchema,
  listMovementsSchema,
  openingStockSchema,
  stockCardSchema,
  transferSchema,
  updateMaterialSchema,
  wastageSchema,
} from "@/modules/materials/schemas";
import {
  assertUnitFits,
  documentDate,
  lineMemo,
  linkMovementsToEntry,
  lockMaterials,
  materialLabel,
  putIntoStore,
  resolveStore,
  stockIn,
  stockOut,
  takeFromStore,
  writeMovement,
} from "@/modules/materials/stock";
import {
  CODE_PREFIX,
  formatQuantity,
  money,
  pendingQuantity,
  qty,
  UNIT_LABELS,
  unitCost,
  ZERO,
} from "@/modules/materials/valuation";

/*
 * Raw materials: fabric, trims, accessories and packaging, held in one or more
 * stores and valued at moving average cost. Every change reaches the books:
 *   Purchase (bill)          Dr Raw Materials            Cr Payable (supplier)
 *   Opening stock            Dr Raw Materials            Cr Opening Balance Equity
 *   Count gain / loss        Dr Raw Materials / Losses   Cr Losses / Raw Materials
 *   Wastage                  Dr Production & Inventory Losses   Cr Raw Materials
 *   Issue to production      Dr Work in Progress         Cr Raw Materials
 *   Return from production   Dr Raw Materials            Cr Work in Progress
 *   Return to supplier       Dr Payable (supplier)       Cr Raw Materials (± cost difference)
 * Moving stock between stores changes quantities only.
 */

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 30_000 };
export const OPEN_ORDER: PurchaseOrderStatus[] = ["OPEN", "PARTIALLY_RECEIVED"];

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

const supplierSelect = { id: true, code: true, name: true } as const;

/** A material as the API shows it; prices and values only to those who may see them. */
export function presentMaterial(
  ctx: CompanyContext,
  m: RawMaterial & { supplier?: { id: string; code: string | null; name: string } | null },
) {
  const cost = costMask(ctx);
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    kind: m.kind,
    unit: m.unit,
    unitLabel: UNIT_LABELS[m.unit],
    color: m.color,
    specification: m.specification,
    /** On hand in every store. */
    quantity: m.quantity,
    reorderLevel: m.reorderLevel,
    isLow: m.reorderLevel !== null && m.quantity.lte(m.reorderLevel),
    avgCost: cost(m.avgCost),
    stockValue: cost(m.stockValue),
    supplier: m.supplier ?? null,
    isActive: m.isActive,
    notes: m.notes,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

// =============================================================================
// Catalogue
// =============================================================================

async function assertSupplier(ctx: CompanyContext, supplierId: string) {
  const party = await ctx.db.party.findUnique({
    where: { id: supplierId },
    select: { name: true, kind: true },
  });
  if (!party) throw new AppError("NOT_FOUND", "Supplier not found.");
  if (party.kind !== "SUPPLIER" && party.kind !== "BOTH") {
    throw new AppError("VALIDATION", `${party.name} is not set up as a supplier.`, {
      supplierId: ["Choose a supplier"],
    });
  }
}

/** One material code change or new code at a time per company. */
async function lockMaterialCodes(tx: Tx, companyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`material-code:${companyId}`}))`;
}

async function assertCodeFree(tx: Tx, companyId: string, code: string, exceptId?: string) {
  const clash = await tx.rawMaterial.findFirst({
    where: {
      companyId,
      code: { equals: code, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { code: true, name: true },
  });
  if (clash) {
    throw new AppError("CONFLICT", `${clash.code} is already used by ${clash.name}.`, {
      code: ["Choose another code"],
    });
  }
}

/** The next free code of a kind: FAB-0001, FAB-0002... */
async function nextMaterialCode(tx: Tx, companyId: string, prefix: string) {
  const [row] = await tx.$queryRaw<Array<{ last: Prisma.Decimal | null }>>`
    SELECT MAX(CAST(SUBSTRING(code FROM ${prefix.length + 2}::int) AS NUMERIC)) AS last
    FROM "RawMaterial"
    WHERE "companyId" = ${companyId} AND code ~* ${`^${prefix}-[0-9]{1,12}$`}`;
  const next = Number(row?.last ?? 0) + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

const assertCanEditCatalogue = (ctx: CompanyContext) =>
  assertAnyPermission(
    ctx,
    ["materials.manage", "materials.purchase"],
    "You do not have permission to add or change raw materials.",
  );

export async function createMaterial(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createMaterialSchema.parse(raw);
  assertCanEditCatalogue(ctx);
  const companyId = ctx.company.id;
  if (input.supplierId) await assertSupplier(ctx, input.supplierId);
  const reorderLevel = input.reorderLevel == null ? null : qty(input.reorderLevel);
  if (reorderLevel) {
    assertUnitFits({ code: input.name, unit: input.unit }, reorderLevel, "reorderLevel");
  }
  const material = await runTransaction(async (tx) => {
    await lockMaterialCodes(tx, companyId);
    if (input.code) await assertCodeFree(tx, companyId, input.code);
    const created = await tx.rawMaterial.create({
      data: {
        companyId,
        code: input.code ?? (await nextMaterialCode(tx, companyId, CODE_PREFIX[input.kind])),
        name: input.name,
        kind: input.kind,
        unit: input.unit,
        color: input.color ?? null,
        specification: input.specification ?? null,
        reorderLevel,
        supplierId: input.supplierId ?? null,
        notes: input.notes ?? null,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "RawMaterial",
        entityId: created.id,
        summary: `Added raw material ${materialLabel(created)} (${created.kind.toLowerCase()}, counted in ${UNIT_LABELS[created.unit]})`,
      },
      tx,
    );
    return created;
  }, TX_OPTIONS);
  return getMaterial(ctx, material.id);
}

export async function updateMaterial(
  ctx: CompanyContext,
  materialId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateMaterialSchema.parse(raw);
  assertCanEditCatalogue(ctx);
  const companyId = ctx.company.id;
  if (input.supplierId) await assertSupplier(ctx, input.supplierId);
  await runTransaction(async (tx) => {
    if (input.code) await lockMaterialCodes(tx, companyId);
    const m = (await lockMaterials(tx, companyId, [materialId])).get(materialId)!;
    if (input.code && input.code !== m.code) await assertCodeFree(tx, companyId, input.code, m.id);

    const unit = input.unit ?? m.unit;
    if (unit !== m.unit) {
      const used =
        (await tx.rawMaterialMovement.count({ where: { rawMaterialId: m.id } })) +
        (await tx.purchaseOrderLine.count({ where: { rawMaterialId: m.id } })) +
        (await tx.supplierBillItem.count({ where: { rawMaterialId: m.id } }));
      if (used > 0) {
        throw new AppError(
          "CONFLICT",
          `${m.code} already has stock or orders in ${UNIT_LABELS[m.unit]}, so its unit can no longer change. Add a new material instead.`,
        );
      }
    }
    const reorderLevel =
      input.reorderLevel === undefined
        ? undefined
        : input.reorderLevel === null
          ? null
          : qty(input.reorderLevel);
    if (reorderLevel) assertUnitFits({ code: m.code, unit }, reorderLevel, "reorderLevel");

    if (input.isActive === false && m.isActive) {
      if (m.quantity.gt(0)) {
        throw new AppError(
          "CONFLICT",
          `${m.code} still has ${formatQuantity(m.quantity, m.unit)} in stock; use it up, count it or record it as wastage before archiving.`,
        );
      }
      const onOrder = await tx.purchaseOrderLine.count({
        where: {
          rawMaterialId: m.id,
          order: { companyId, status: { in: OPEN_ORDER } },
          receivedQty: { lt: prisma.purchaseOrderLine.fields.quantity },
        },
      });
      if (onOrder > 0) {
        throw new AppError(
          "CONFLICT",
          `${m.code} is still due on an open purchase order; receive, close or cancel it before archiving.`,
        );
      }
    }

    const updated = await tx.rawMaterial.update({
      where: { id: m.id },
      data: {
        code: input.code,
        name: input.name,
        kind: input.kind,
        unit: input.unit,
        color: input.color,
        specification: input.specification,
        reorderLevel,
        supplierId: input.supplierId,
        notes: input.notes,
        isActive: input.isActive,
      },
    });
    const state =
      input.isActive === undefined || input.isActive === m.isActive
        ? ""
        : input.isActive
          ? " (active again)"
          : " (archived)";
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "RawMaterial",
        entityId: m.id,
        summary: `Updated raw material ${materialLabel(updated)}${state}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getMaterial(ctx, materialId);
}

/** Open purchase order lines still to arrive, per material. */
async function incomingFor(companyId: string, materialIds: string[]) {
  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      rawMaterialId: { in: materialIds },
      order: { companyId, status: { in: OPEN_ORDER } },
    },
    include: {
      order: {
        select: {
          id: true,
          number: true,
          orderDate: true,
          expectedDate: true,
          status: true,
          supplier: { select: supplierSelect },
        },
      },
    },
    orderBy: [{ order: { orderDate: "asc" } }, { id: "asc" }],
  });
  return lines.filter((l) => pendingQuantity(l).gt(0));
}

export async function getMaterial(ctx: CompanyContext, materialId: string) {
  const cost = costMask(ctx);
  const m = await ctx.db.rawMaterial.findUnique({
    where: { id: materialId },
    include: {
      supplier: { select: supplierSelect },
      stocks: {
        where: { quantity: { not: 0 } },
        include: { warehouse: { select: { id: true, name: true, isDefault: true } } },
        orderBy: { warehouse: { name: "asc" } },
      },
    },
  });
  if (!m) throw new AppError("NOT_FOUND", "Raw material not found.");
  const incoming = await incomingFor(ctx.company.id, [m.id]);
  return {
    ...presentMaterial(ctx, m),
    /** Quantity in each store. */
    stores: m.stocks.map((s) => ({ warehouse: s.warehouse, quantity: s.quantity })),
    /** Ordered from suppliers and still to arrive. */
    incomingQuantity: incoming.reduce((t, l) => t.plus(pendingQuantity(l)), ZERO),
    incoming: incoming.map((l) => ({
      orderId: l.order.id,
      number: l.order.number,
      status: l.order.status,
      supplier: l.order.supplier,
      orderDate: dateOnly(l.order.orderDate),
      expectedDate: dateOnly(l.order.expectedDate),
      ordered: l.quantity,
      received: l.receivedQty,
      pending: pendingQuantity(l),
      unitPrice: cost(l.unitPrice),
    })),
  };
}

export async function listMaterials(ctx: CompanyContext, raw: unknown = {}) {
  const q = listMaterialsSchema.parse(raw);
  const take = q.take ?? 50;
  const and: Prisma.RawMaterialWhereInput[] = [];
  if (!q.includeInactive) and.push({ isActive: true });
  if (q.kind) and.push({ kind: q.kind });
  if (q.supplierId) and.push({ supplierId: q.supplierId });
  if (q.lowStock) {
    and.push({
      reorderLevel: { not: null },
      quantity: { lte: prisma.rawMaterial.fields.reorderLevel },
    });
  }
  if (q.inStock) {
    and.push(
      q.warehouseId
        ? { stocks: { some: { warehouseId: q.warehouseId, quantity: { gt: 0 } } } }
        : { quantity: { gt: 0 } },
    );
  }
  if (q.search) {
    const contains = { contains: q.search, mode: "insensitive" } as const;
    and.push({
      OR: [
        { code: contains },
        { name: contains },
        { color: contains },
        { specification: contains },
      ],
    });
  }
  const rows = await ctx.db.rawMaterial.findMany({
    where: { AND: and },
    include: {
      supplier: { select: supplierSelect },
      stocks: {
        where: q.warehouseId ? { warehouseId: q.warehouseId } : { quantity: { not: 0 } },
        select: { warehouseId: true, quantity: true },
      },
    },
    orderBy: [{ code: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const incoming = await incomingFor(
    ctx.company.id,
    page.map((m) => m.id),
  );
  const incomingBy = new Map<string, Prisma.Decimal>();
  for (const l of incoming) {
    incomingBy.set(
      l.rawMaterialId,
      (incomingBy.get(l.rawMaterialId) ?? ZERO).plus(pendingQuantity(l)),
    );
  }
  return {
    items: page.map((m) => ({
      ...presentMaterial(ctx, m),
      /** In the store asked for (null without a store filter). */
      storeQuantity: q.warehouseId ? m.stocks.reduce((t, s) => t.plus(s.quantity), ZERO) : null,
      /** How many stores hold some of it. */
      stores: m.stocks.filter((s) => !s.quantity.isZero()).length,
      incomingQuantity: incomingBy.get(m.id) ?? ZERO,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
}

/**
 * The store at a glance: value by kind, materials at or below their reorder
 * level, what each store holds and purchase orders running late.
 */
export async function getMaterialsSummary(ctx: CompanyContext) {
  const cost = costMask(ctx);
  const day = today(ctx);
  const materials = await ctx.db.rawMaterial.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      unit: true,
      quantity: true,
      stockValue: true,
      reorderLevel: true,
    },
    orderBy: { code: "asc" },
  });
  const byKind = new Map<
    string,
    { kind: string; materials: number; inStock: number; value: Prisma.Decimal }
  >();
  for (const m of materials) {
    const row = byKind.get(m.kind) ?? { kind: m.kind, materials: 0, inStock: 0, value: ZERO };
    row.materials += 1;
    if (m.quantity.gt(0)) row.inStock += 1;
    row.value = row.value.plus(m.stockValue);
    byKind.set(m.kind, row);
  }
  const low = materials.filter((m) => m.reorderLevel !== null && m.quantity.lte(m.reorderLevel));
  const incoming = await incomingFor(
    ctx.company.id,
    low.map((m) => m.id),
  );
  const stores = await ctx.db.rawMaterialStock.groupBy({
    by: ["warehouseId"],
    where: { quantity: { gt: 0 } },
    _count: { _all: true },
  });
  const storeNames = new Map(
    (
      await ctx.db.warehouse.findMany({
        where: { id: { in: stores.map((s) => s.warehouseId) } },
        select: { id: true, name: true },
      })
    ).map((w) => [w.id, w.name]),
  );
  const openOrders = await ctx.db.purchaseOrder.groupBy({
    by: ["status"],
    where: { status: { in: OPEN_ORDER } },
    _count: { _all: true },
  });
  const late = await ctx.db.purchaseOrder.findMany({
    where: { status: { in: OPEN_ORDER }, expectedDate: { lt: dateColumn(day) } },
    select: {
      id: true,
      number: true,
      status: true,
      expectedDate: true,
      supplier: { select: supplierSelect },
      project: { select: { id: true, code: true } },
    },
    orderBy: [{ expectedDate: "asc" }, { number: "asc" }],
    take: 50,
  });
  const total = materials.reduce((t, m) => t.plus(m.stockValue), ZERO);
  const countOf = (status: PurchaseOrderStatus) =>
    openOrders.find((o) => o.status === status)?._count._all ?? 0;
  return {
    asOf: day,
    totals: {
      materials: materials.length,
      inStock: materials.filter((m) => m.quantity.gt(0)).length,
      value: cost(total),
    },
    byKind: [...byKind.values()].map((k) => ({ ...k, value: cost(k.value) })),
    lowStock: low
      .map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        unit: m.unit,
        quantity: m.quantity,
        reorderLevel: m.reorderLevel,
        incomingQuantity: incoming
          .filter((l) => l.rawMaterialId === m.id)
          .reduce((t, l) => t.plus(pendingQuantity(l)), ZERO),
      }))
      .slice(0, 100),
    stores: stores
      .map((s) => ({
        warehouse: { id: s.warehouseId, name: storeNames.get(s.warehouseId) ?? "" },
        materials: s._count._all,
      }))
      .sort((a, b) => a.warehouse.name.localeCompare(b.warehouse.name)),
    purchaseOrders: {
      open: countOf("OPEN"),
      partiallyReceived: countOf("PARTIALLY_RECEIVED"),
      overdue: late.map((o) => ({
        ...o,
        expectedDate: dateOnly(o.expectedDate),
        daysLate: Math.round(
          (Date.parse(`${day}T00:00:00Z`) - o.expectedDate!.getTime()) / 86_400_000,
        ),
      })),
    },
  };
}

// =============================================================================
// The store: opening stock, counts, wastage and transfers
// =============================================================================

/** Posts a store entry when it carries a value (zero-value changes reach no ledger). */
async function postStoreEntry(
  tx: Tx,
  ctx: CompanyContext,
  args: {
    date: Date;
    description: string;
    movementId: string;
    lines: JournalLineInput[];
  },
) {
  const value = args.lines.reduce((t, l) => t.plus(l.debit ?? 0), ZERO);
  if (value.lte(0)) return null;
  const entry = await postJournalEntry(tx, {
    companyId: ctx.company.id,
    date: args.date,
    description: args.description,
    sourceType: "STOCK_ADJUSTMENT",
    sourceId: args.movementId,
    postedById: ctx.user.id,
    lines: args.lines,
  });
  await linkMovementsToEntry(tx, [args.movementId], entry.id);
  return entry;
}

/** Brings stock held before the ERP into the books, at what it cost. */
export async function addOpeningStock(
  ctx: CompanyContext,
  materialId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = openingStockSchema.parse(raw);
  assertAnyPermission(
    ctx,
    ["materials.purchase", "accounts.manage"],
    "Opening stock brings a value into the books; only buyers (materials.purchase) or Accounts can enter it.",
  );
  const companyId = ctx.company.id;
  const store = await resolveStore(ctx, input.warehouseId);
  const date = documentDate(ctx, input.date);
  const quantity = qty(input.quantity);
  const price = unitCost(input.unitCost);
  const value = money(quantity.times(price));
  await runTransaction(async (tx) => {
    const state = await lockMaterials(tx, companyId, [materialId]);
    const m = state.get(materialId)!;
    if (!m.isActive) throw new AppError("CONFLICT", `${materialLabel(m)} is archived.`);
    assertUnitFits(m, quantity);
    const { movement } = await stockIn(tx, state, {
      companyId,
      createdById: ctx.user.id,
      materialId: m.id,
      warehouseId: store.id,
      type: "OPENING",
      quantity,
      value,
      date,
      note: input.note,
    });
    const acc = await ensureControlAccounts(companyId, tx);
    const memo = lineMemo(m, quantity);
    await postStoreEntry(tx, ctx, {
      date,
      description: `Opening stock — ${materialLabel(m)}: ${formatQuantity(quantity, m.unit)} in ${store.name}`,
      movementId: movement.id,
      lines: [
        { accountId: acc.RAW_MATERIALS, debit: value, memo },
        { accountId: acc.OPENING_EQUITY, credit: value, memo },
      ],
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STOCK_ADJUSTMENT",
        entityType: "RawMaterial",
        entityId: m.id,
        summary: `Opening stock ${m.code}: +${formatQuantity(quantity, m.unit)} at ${price.toFixed(4)} in ${store.name} (${value.toFixed(2)})`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getMaterial(ctx, materialId);
}

/**
 * A physical count: the store's quantity is set to what was counted. Extra
 * stock comes in at the average cost (a gain), missing stock goes out at it
 * (a loss), both against Production & Inventory Losses.
 */
export async function countStock(
  ctx: CompanyContext,
  materialId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = countStockSchema.parse(raw);
  assertCanKeepStore(ctx);
  const companyId = ctx.company.id;
  const store = await resolveStore(ctx, input.warehouseId);
  const date = documentDate(ctx, input.date);
  const counted = qty(input.countedQuantity);
  await runTransaction(async (tx) => {
    const state = await lockMaterials(tx, companyId, [materialId]);
    const m = state.get(materialId)!;
    assertUnitFits(m, counted, "countedQuantity");
    const current =
      (
        await tx.rawMaterialStock.findUnique({
          where: { rawMaterialId_warehouseId: { rawMaterialId: m.id, warehouseId: store.id } },
          select: { quantity: true },
        })
      )?.quantity ?? ZERO;
    const delta = counted.minus(current);
    if (delta.isZero()) {
      throw new AppError(
        "VALIDATION",
        `${store.name} already shows ${formatQuantity(counted, m.unit)} of ${m.code}; there is nothing to correct.`,
      );
    }
    const move = {
      companyId,
      createdById: ctx.user.id,
      materialId: m.id,
      warehouseId: store.id,
      type: "ADJUSTMENT" as const,
      quantity: delta.abs(),
      date,
      note: input.note ?? `Counted ${formatQuantity(counted, m.unit)}`,
    };
    const acc = await ensureControlAccounts(companyId, tx);
    const memo = lineMemo(m, delta.abs());
    const gain = delta.gt(0);
    const { movement, value } = gain
      ? await stockIn(tx, state, { ...move, value: money(delta.times(m.avgCost)) })
      : await stockOut(tx, state, move);
    await postStoreEntry(tx, ctx, {
      date,
      description: `Stock count correction — ${materialLabel(m)}: ${gain ? "+" : "-"}${formatQuantity(
        delta.abs(),
        m.unit,
      )} in ${store.name}`,
      movementId: movement.id,
      lines: gain
        ? [
            { accountId: acc.RAW_MATERIALS, debit: value, memo },
            { accountId: acc.PRODUCTION_LOSS, credit: value, memo },
          ]
        : [
            { accountId: acc.PRODUCTION_LOSS, debit: value, memo },
            { accountId: acc.RAW_MATERIALS, credit: value, memo },
          ],
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STOCK_ADJUSTMENT",
        entityType: "RawMaterial",
        entityId: m.id,
        summary: `Counted ${m.code} in ${store.name}: ${formatQuantity(counted, m.unit)} (${
          gain ? "+" : "-"
        }${formatQuantity(delta.abs(), m.unit)})`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getMaterial(ctx, materialId);
}

/** Damaged or spoilt in the store: out at the average cost, booked as a loss. */
export async function recordWastage(
  ctx: CompanyContext,
  materialId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = wastageSchema.parse(raw);
  assertCanKeepStore(ctx);
  const companyId = ctx.company.id;
  const store = await resolveStore(ctx, input.warehouseId);
  const date = documentDate(ctx, input.date);
  const quantity = qty(input.quantity);
  await runTransaction(async (tx) => {
    const state = await lockMaterials(tx, companyId, [materialId]);
    const m = state.get(materialId)!;
    assertUnitFits(m, quantity);
    const { movement, value } = await stockOut(tx, state, {
      companyId,
      createdById: ctx.user.id,
      materialId: m.id,
      warehouseId: store.id,
      type: "WASTAGE",
      quantity,
      date,
      note: input.reason,
    });
    const acc = await ensureControlAccounts(companyId, tx);
    const memo = lineMemo(m, quantity);
    await postStoreEntry(tx, ctx, {
      date,
      description: `Wastage — ${materialLabel(m)}: ${formatQuantity(quantity, m.unit)} in ${store.name} (${input.reason})`,
      movementId: movement.id,
      lines: [
        { accountId: acc.PRODUCTION_LOSS, debit: value, memo },
        { accountId: acc.RAW_MATERIALS, credit: value, memo },
      ],
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STOCK_ADJUSTMENT",
        entityType: "RawMaterial",
        entityId: m.id,
        summary: `Wastage ${m.code} in ${store.name}: ${formatQuantity(quantity, m.unit)} — ${input.reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getMaterial(ctx, materialId);
}

/** Moves stock from one store to another; the material's value does not change. */
export async function transferStock(
  ctx: CompanyContext,
  materialId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = transferSchema.parse(raw);
  assertCanKeepStore(ctx);
  const companyId = ctx.company.id;
  const from = await resolveStore(ctx, input.fromWarehouseId);
  const to = await resolveStore(ctx, input.toWarehouseId);
  const date = documentDate(ctx, input.date);
  const quantity = qty(input.quantity);
  await runTransaction(async (tx) => {
    const m = (await lockMaterials(tx, companyId, [materialId])).get(materialId)!;
    assertUnitFits(m, quantity);
    await takeFromStore(tx, m, from.id, quantity);
    await putIntoStore(tx, companyId, m.id, to.id, quantity);
    const base = {
      companyId,
      createdById: ctx.user.id,
      materialId: m.id,
      quantity,
      date,
      note: input.note,
      links: { transferId: randomUUID() },
    };
    const zero = { value: ZERO, unitCost: m.avgCost };
    await writeMovement(
      tx,
      { ...base, warehouseId: from.id, type: "TRANSFER_OUT" },
      { ...zero, quantity: quantity.neg() },
    );
    await writeMovement(
      tx,
      { ...base, warehouseId: to.id, type: "TRANSFER_IN" },
      { ...zero, quantity },
    );
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STOCK_ADJUSTMENT",
        entityType: "RawMaterial",
        entityId: m.id,
        summary: `Moved ${formatQuantity(quantity, m.unit)} of ${m.code} from ${from.name} to ${to.name}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getMaterial(ctx, materialId);
}

// =============================================================================
// Stock card and movements
// =============================================================================

const movementInclude = {
  warehouse: { select: { id: true, name: true } },
  productionProject: { select: { id: true, code: true, name: true } },
  supplierBill: {
    select: { id: true, number: true, supplierRef: true, supplier: { select: supplierSelect } },
  },
  issue: { select: { id: true, number: true, kind: true } },
  purchaseReturn: { select: { id: true, number: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.RawMaterialMovementInclude;

type MovementRow = Prisma.RawMaterialMovementGetPayload<{ include: typeof movementInclude }>;

/** The other store of each transfer among the rows. */
async function transferCounterparts(ctx: CompanyContext, rows: MovementRow[]) {
  const ids = [...new Set(rows.flatMap((r) => (r.transferId ? [r.transferId] : [])))];
  if (ids.length === 0) return new Map<string, { id: string; name: string }>();
  const sides = await ctx.db.rawMaterialMovement.findMany({
    where: { transferId: { in: ids } },
    select: { id: true, transferId: true, warehouse: { select: { id: true, name: true } } },
  });
  const other = new Map<string, { id: string; name: string }>();
  for (const row of rows) {
    if (!row.transferId) continue;
    const side = sides.find((s) => s.transferId === row.transferId && s.id !== row.id);
    if (side) other.set(row.id, side.warehouse);
  }
  return other;
}

/** Which document a stock card line came from. */
function documentOf(r: MovementRow) {
  if (r.purchaseReturn) {
    return {
      type: "SUPPLIER_RETURN" as const,
      id: r.purchaseReturn.id,
      number: r.purchaseReturn.number,
    };
  }
  if (r.supplierBill) {
    return {
      type: "BILL" as const,
      id: r.supplierBill.id,
      number: r.supplierBill.number,
      supplierRef: r.supplierBill.supplierRef,
      supplier: r.supplierBill.supplier,
    };
  }
  if (r.issue) {
    return {
      type: r.issue.kind === "ISSUE" ? ("MATERIAL_ISSUE" as const) : ("MATERIAL_RETURN" as const),
      id: r.issue.id,
      number: r.issue.number,
    };
  }
  return null;
}

function presentMovement(
  ctx: CompanyContext,
  r: MovementRow,
  otherStore: { id: string; name: string } | undefined,
) {
  const cost = costMask(ctx);
  return {
    id: r.id,
    date: r.date,
    type: r.type,
    warehouse: r.warehouse,
    /** + into the store, - out of it. */
    quantity: r.quantity,
    unitCost: cost(r.unitCost),
    /** + into the books, - out of them. */
    value: cost(r.value),
    project: r.productionProject,
    document: documentOf(r),
    /** For a transfer: the store the stock came from or went to. */
    otherStore: otherStore ?? null,
    note: r.note,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

const CARD_LIMIT = 2000;

/**
 * A material's stock card: every movement in date order with the running
 * balance, after the balance brought forward from before `from`. With a store
 * the card shows that store's quantities; values are kept company-wide only.
 */
export async function getStockCard(ctx: CompanyContext, materialId: string, raw: unknown = {}) {
  const q = stockCardSchema.parse(raw);
  const cost = costMask(ctx);
  const m = await ctx.db.rawMaterial.findUnique({
    where: { id: materialId },
    include: { supplier: { select: supplierSelect } },
  });
  if (!m) throw new AppError("NOT_FOUND", "Raw material not found.");
  const store = q.warehouseId ? await resolveStore(ctx, q.warehouseId) : null;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const base: Prisma.RawMaterialMovementWhereInput = {
    rawMaterialId: m.id,
    ...(store ? { warehouseId: store.id } : {}),
  };
  const brought = start
    ? await ctx.db.rawMaterialMovement.aggregate({
        where: { ...base, date: { lt: start } },
        _sum: { quantity: true, value: true },
      })
    : null;
  const rows = await ctx.db.rawMaterialMovement.findMany({
    where: {
      ...base,
      ...(start || end
        ? { date: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    include: movementInclude,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: CARD_LIMIT + 1,
  });
  const hasMore = rows.length > CARD_LIMIT;
  const page = hasMore ? rows.slice(0, CARD_LIMIT) : rows;
  const counterparts = await transferCounterparts(ctx, page);
  const openingQuantity = brought?._sum.quantity ?? ZERO;
  const openingValue = brought?._sum.value ?? ZERO;
  let quantity = openingQuantity;
  let value = openingValue;
  const lines = page.map((r) => {
    quantity = quantity.plus(r.quantity);
    value = value.plus(r.value);
    return {
      ...presentMovement(ctx, r, counterparts.get(r.id)),
      balance: quantity,
      balanceValue: store ? null : cost(value),
    };
  });
  return {
    material: presentMaterial(ctx, m),
    warehouse: store ? { id: store.id, name: store.name } : null,
    opening: { quantity: openingQuantity, value: store ? null : cost(openingValue) },
    lines,
    closing: { quantity, value: store ? null : cost(value) },
    /** More than 2,000 lines: narrow the dates to see the rest. */
    hasMore,
  };
}

export async function listMovements(ctx: CompanyContext, raw: unknown = {}) {
  const q = listMovementsSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.rawMaterialMovement.findMany({
    where: {
      ...(q.materialId ? { rawMaterialId: q.materialId } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.projectId ? { productionProjectId: q.projectId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(start || end
        ? { date: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    include: {
      ...movementInclude,
      rawMaterial: { select: { id: true, code: true, name: true, unit: true, kind: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const counterparts = await transferCounterparts(ctx, page);
  return {
    items: page.map((r) => ({
      ...presentMovement(ctx, r, counterparts.get(r.id)),
      material: r.rawMaterial,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
}
