import { type BillStatus, Prisma, type ProductionStatus, type StockGrade } from "@prisma/client";
import { z } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ZERO } from "@/modules/accounts/balances";
import { supplierProjectBalances } from "@/modules/accounts/supplier-projects";
import type { CompanyContext } from "@/modules/auth/context";
import {
  archiveTypes,
  mayPrintType,
  PRINT_INFO,
  visibleDocumentsWhere,
} from "@/modules/documents/print.service";
import type { PrintType } from "@/modules/documents/model";
import { canSeeMaterialCosts } from "@/modules/materials/access";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { supplierProfileShows } from "@/modules/parties/profile-access";
import { canSeeProductionCosts } from "@/modules/production/project-costs";
import { settledByProject } from "@/modules/production/settlement.service";

/*
 * Supplier 360°: one supplier's whole relationship with the company, read from
 * the existing records (nothing here writes). On top of the profile:
 *   - what is due to them on their ledger (the master ledger: every bill, Due
 *     expense and opening balance less what was paid), what was billed and paid
 *     in all, and what their open bills still owe;
 *   - the production projects they work on (as the factory, or through their
 *     bills and purchase orders), active and completed: what each project was
 *     billed, paid and still owes them, and for a completed project the
 *     settlement made when it closed (production/settlement.service.ts);
 *   - the goods they delivered: raw materials bought from them into the store,
 *     and the finished goods their factory delivered from projects;
 *   - their purchase orders (the running ledger of accessories suppliers), bills,
 *     payments and the documents printed for them.
 *
 * Amounts need the money flag, projects and finished goods production.view, and
 * purchase orders and raw material deliveries materials.view
 * (parties/profile-access.ts); what the reader may not see is left out (null),
 * the same way on screen, in the API and the PDF. Buyers are not suppliers:
 * their profile answers "not found" here.
 */

/** Rows each list shows on the profile; the rest open with "Show all". */
export const SUPPLIER_PROFILE_ROWS = 8;

/** A list opened in full, and the PDF, show at most this many rows each. */
export const SUPPLIER_PROFILE_ALL_ROWS = 500;

export const SUPPLIER_HISTORIES = [
  "active",
  "completed",
  "deliveries",
  "orders",
  "bills",
  "payments",
  "documents",
] as const;

export type SupplierHistory = (typeof SUPPLIER_HISTORIES)[number];

const optionsSchema = z.object({
  /** One list in full, or all of them (the PDF). */
  all: z.union([z.enum(SUPPLIER_HISTORIES), z.literal("everything")]).optional(),
});

export type Supplier360Options = z.input<typeof optionsSchema>;

type Amount = Prisma.Decimal;
const fixed = (value: Amount) => value.toFixed(2);
const quantity = (value: Amount) => value.toFixed(3).replace(/\.?0+$/, "");

/** Projects still running; the rest (completed or cancelled) are closed. */
const OPEN_PROJECT: ProductionStatus[] = ["PLANNED", "ACTIVE", "ON_HOLD"];

/** Payments that still count: their journal entry has not been reversed. */
const livePayment = {
  OR: [{ journalEntryId: null }, { journalEntry: { isReversed: false } }],
} satisfies Prisma.PaymentWhereInput;

/** A list's rows: the latest few, or all of them (up to SUPPLIER_PROFILE_ALL_ROWS). */
function take(options: z.output<typeof optionsSchema>, history: SupplierHistory) {
  return options.all === "everything" || options.all === history
    ? SUPPLIER_PROFILE_ALL_ROWS
    : SUPPLIER_PROFILE_ROWS;
}

/** Where a bill opens for this person: Raw materials for a purchase, else Production. */
function billLink(ctx: CompanyContext, isPurchase: boolean): "purchase" | "bill" | null {
  if (isPurchase && ctx.can("materials.view") && canSeeMaterialCosts(ctx)) return "purchase";
  if (ctx.can("production.view") && canSeeProductionCosts(ctx)) return "bill";
  return null;
}

// =============================================================================
// Projects
// =============================================================================

const projectSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  stage: true,
  startDate: true,
  targetDate: true,
  completedAt: true,
  targetQuantity: true,
  producedQtyA: true,
  producedQtyB: true,
  factoryId: true,
  isInHouse: true,
  buyer: { select: { id: true, name: true } },
  style: { select: { id: true, code: true } },
} satisfies Prisma.ProductionProjectSelect;

/**
 * The projects this supplier works on: as the factory, through a bill charged to
 * the project, or a purchase order made for it. Newest first, split into the
 * ones still running and the closed ones.
 */
async function projectLists(
  ctx: CompanyContext,
  supplier: { id: string; supplierCategories: Parameters<typeof settledByProject>[0] },
  money: boolean,
  rows: { active: number; completed: number },
) {
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const [balances, statements, ordered] = await Promise.all([
    supplierProjectBalances(prisma, companyId, supplier.id),
    prisma.projectSettlement.findMany({
      where: { companyId, supplierId: supplier.id, reopenedAt: null },
      orderBy: { settledAt: "desc" },
    }),
    ctx.db.purchaseOrder.findMany({
      where: { supplierId: supplier.id, projectId: { not: null } },
      select: { projectId: true },
      distinct: ["projectId"],
    }),
  ]);
  const settled = new Map<string, (typeof statements)[number]>();
  for (const s of statements) if (!settled.has(s.projectId)) settled.set(s.projectId, s);
  const linked = [
    ...new Set([
      ...balances.keys(),
      ...settled.keys(),
      ...ordered.flatMap((o) => (o.projectId ? [o.projectId] : [])),
    ]),
  ];
  const projects = await ctx.db.productionProject.findMany({
    where: { OR: [{ factoryId: supplier.id }, { id: { in: linked } }] },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    select: projectSelect,
  });
  const runningLedger = !settledByProject(supplier.supplierCategories);

  const present = (p: (typeof projects)[number]) => {
    const live = balances.get(p.id);
    const statement = p.status === "COMPLETED" ? settled.get(p.id) : undefined;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      stage: p.stage,
      startedOn: localDay(p.startDate, tz),
      targetOn: localDay(p.targetDate, tz),
      completedOn: p.completedAt ? localDay(p.completedAt, tz) : null,
      targetQuantity: p.targetQuantity,
      produced: p.producedQtyA + p.producedQtyB,
      /** They are this project's factory. */
      asFactory: p.factoryId === supplier.id,
      buyer: p.isInHouse ? null : p.buyer,
      style: p.style,
      /** What their bills charge the project, what is paid and what it still owes them. */
      money: money
        ? statement
          ? {
              billed: fixed(statement.billed),
              paid: fixed(statement.paid),
              /** Settled: zero from the day it closed. */
              balance: fixed(ZERO),
              settlement: {
                id: statement.id,
                settledOn: localDay(statement.settledAt, tz),
                /** Left on their ledger when it closed. */
                carried: fixed(statement.carried),
                /** Of that, what their bills for the project still owe today. */
                stillDue: fixed(live?.due ?? ZERO),
              },
            }
          : {
              billed: fixed(live?.billed ?? ZERO),
              paid: fixed(live?.paid ?? ZERO),
              balance: fixed(live?.due ?? ZERO),
              settlement: null,
            }
        : null,
    };
  };

  const active = projects.filter((p) => OPEN_PROJECT.includes(p.status));
  const closed = projects.filter((p) => !OPEN_PROJECT.includes(p.status));
  return {
    /** Accessories suppliers: on a running ledger, not settled project by project. */
    runningLedger,
    active: { total: active.length, items: active.slice(0, rows.active).map(present) },
    completed: { total: closed.length, items: closed.slice(0, rows.completed).map(present) },
    counts: {
      active: active.length,
      completed: closed.filter((p) => p.status === "COMPLETED").length,
    },
  };
}

// =============================================================================
// Deliveries
// =============================================================================

/**
 * What they delivered, newest first: raw materials bought from them into the
 * store (materials.view) and finished goods their factory delivered from a
 * project (production.view). Values need the money flag.
 */
async function deliveryHistory(
  ctx: CompanyContext,
  supplierId: string,
  shows: { money: boolean; production: boolean; materials: boolean },
  rows: number,
) {
  const tz = ctx.company.timezone;
  const purchaseWhere: Prisma.SupplierBillWhereInput = { supplierId, items: { some: {} } };
  const goodsWhere: Prisma.StockIntakeWhereInput = {
    project: { factoryId: supplierId },
    status: { in: ["CONFIRMED", "REVERSED"] },
  };
  const [purchaseCount, purchases, goodsCount, goods, lastPurchase, lastGoods] = await Promise.all([
    shows.materials ? ctx.db.supplierBill.count({ where: purchaseWhere }) : 0,
    shows.materials
      ? ctx.db.supplierBill.findMany({
          where: purchaseWhere,
          orderBy: [{ billDate: "desc" }, { id: "desc" }],
          take: rows,
          select: {
            id: true,
            number: true,
            supplierRef: true,
            billDate: true,
            status: true,
            totalAmount: true,
            warehouse: { select: { name: true } },
            purchaseOrder: {
              select: { id: true, number: true, project: { select: { id: true, code: true } } },
            },
            items: {
              orderBy: { amount: "desc" },
              select: {
                quantity: true,
                rawMaterial: { select: { id: true, code: true, name: true, unit: true } },
              },
            },
          },
        })
      : [],
    shows.production ? ctx.db.stockIntake.count({ where: goodsWhere }) : 0,
    shows.production
      ? ctx.db.stockIntake.findMany({
          where: goodsWhere,
          orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
          take: rows,
          select: {
            id: true,
            number: true,
            status: true,
            confirmedAt: true,
            createdAt: true,
            warehouse: { select: { name: true } },
            project: { select: { id: true, code: true, name: true } },
            lines: { select: { grade: true, quantity: true } },
          },
        })
      : [],
    shows.materials
      ? ctx.db.supplierBill.findFirst({
          where: { ...purchaseWhere, status: { not: "VOID" } },
          orderBy: { billDate: "desc" },
          select: { billDate: true },
        })
      : null,
    shows.production
      ? ctx.db.stockIntake.findFirst({
          where: { ...goodsWhere, status: "CONFIRMED" },
          orderBy: { confirmedAt: "desc" },
          select: { confirmedAt: true },
        })
      : null,
  ]);
  if (!shows.materials && !shows.production) return null;

  const dated = [
    ...purchases.map((b) => ({
      at: b.billDate,
      kind: "MATERIALS" as const,
      id: b.id,
      number: b.number,
      deliveredOn: localDay(b.billDate, tz),
      /** No longer counts: a void purchase, or a delivery that was undone. */
      undone: b.status === "VOID",
      reference: b.supplierRef,
      warehouse: b.warehouse?.name ?? null,
      order: b.purchaseOrder ? { id: b.purchaseOrder.id, number: b.purchaseOrder.number } : null,
      project: b.purchaseOrder?.project ?? null,
      materials: b.items.map((i) => ({
        id: i.rawMaterial.id,
        code: i.rawMaterial.code,
        name: i.rawMaterial.name,
        unit: i.rawMaterial.unit,
        quantity: quantity(i.quantity),
      })),
      pieces: null,
      value: shows.money ? fixed(b.totalAmount) : null,
    })),
    ...goods.map((g) => {
      const graded = (grade: StockGrade) =>
        g.lines.filter((l) => l.grade === grade).reduce((s, l) => s + l.quantity, 0);
      return {
        at: g.confirmedAt ?? g.createdAt,
        kind: "GOODS" as const,
        id: g.id,
        number: g.number,
        deliveredOn: localDay(g.confirmedAt ?? g.createdAt, tz),
        undone: g.status === "REVERSED",
        reference: null,
        warehouse: g.warehouse?.name ?? null,
        order: null,
        project: { id: g.project!.id, code: g.project!.code },
        materials: null,
        pieces: { a: graded("A_GRADE"), b: graded("B_GRADE") },
        value: null,
      };
    }),
  ].sort((x, y) => y.at.getTime() - x.at.getTime() || y.id.localeCompare(x.id));
  const items = dated.slice(0, rows).map((d) => ({
    kind: d.kind,
    id: d.id,
    number: d.number,
    deliveredOn: d.deliveredOn,
    undone: d.undone,
    reference: d.reference,
    warehouse: d.warehouse,
    order: d.order,
    project: d.project,
    materials: d.materials,
    pieces: d.pieces,
    value: d.value,
  }));

  const last = [lastPurchase?.billDate, lastGoods?.confirmedAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    total: purchaseCount + goodsCount,
    materials: purchaseCount,
    goods: goodsCount,
    lastOn: last ? localDay(last, tz) : null,
    items,
  };
}

// =============================================================================
// Purchase orders, bills, payments, documents
// =============================================================================

async function orderHistory(c: CompanyContext, supplierId: string, money: boolean, rows: number) {
  const tz = c.company.timezone;
  const where = { supplierId };
  const [total, open, items] = await Promise.all([
    c.db.purchaseOrder.count({ where }),
    c.db.purchaseOrder.count({
      where: { ...where, status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
    }),
    c.db.purchaseOrder.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        number: true,
        status: true,
        orderDate: true,
        expectedDate: true,
        supplierRef: true,
        totalAmount: true,
        project: { select: { id: true, code: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);
  return {
    total,
    /** Still waiting for goods. */
    open,
    items: items.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      orderedOn: localDay(o.orderDate, tz),
      expectedOn: o.expectedDate ? localDay(o.expectedDate, tz) : null,
      reference: o.supplierRef,
      project: o.project,
      lines: o._count.lines,
      total: money ? fixed(o.totalAmount) : null,
    })),
  };
}

async function billHistory(c: CompanyContext, supplierId: string, rows: number) {
  const tz = c.company.timezone;
  const where = { supplierId };
  const [total, items] = await Promise.all([
    c.db.supplierBill.count({ where }),
    c.db.supplierBill.findMany({
      where,
      orderBy: [{ billDate: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        number: true,
        supplierRef: true,
        billDate: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
        dueAmount: true,
        purchaseOrder: { select: { project: { select: { code: true } } } },
        allocations: {
          orderBy: { id: "asc" },
          select: { project: { select: { code: true } }, expenseHead: { select: { name: true } } },
        },
        _count: { select: { items: true } },
      },
    }),
  ]);
  return {
    total,
    items: items.map((b) => {
      const isPurchase = b._count.items > 0;
      const projects = [
        ...new Set([
          ...b.allocations.flatMap((a) => (a.project ? [a.project.code] : [])),
          ...(b.purchaseOrder?.project ? [b.purchaseOrder.project.code] : []),
        ]),
      ];
      return {
        id: b.id,
        number: b.number,
        reference: b.supplierRef,
        billOn: localDay(b.billDate, tz),
        status: b.status as BillStatus,
        /** Raw materials bought into the store, rather than a cost on projects. */
        isPurchase,
        projects,
        heads: [...new Set(b.allocations.map((a) => a.expenseHead.name))],
        total: fixed(b.totalAmount),
        paid: fixed(b.paidAmount),
        due: fixed(b.dueAmount),
        opens: billLink(c, isPurchase),
      };
    }),
  };
}

async function paymentHistory(c: CompanyContext, supplierId: string, rows: number) {
  const tz = c.company.timezone;
  const where: Prisma.PaymentWhereInput = { partyId: supplierId, direction: "PAID" };
  const [total, items] = await Promise.all([
    c.db.payment.count({ where }),
    c.db.payment.findMany({
      where,
      orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        number: true,
        paymentDate: true,
        amount: true,
        method: true,
        reference: true,
        supplierBill: { select: { id: true, number: true } },
        project: { select: { id: true, code: true } },
        journalEntry: { select: { isReversed: true } },
      },
    }),
  ]);
  return {
    total,
    items: items.map((p) => ({
      id: p.id,
      number: p.number,
      paidOn: localDay(p.paymentDate, tz),
      amount: fixed(p.amount),
      method: p.method,
      reference: p.reference,
      bill: p.supplierBill,
      project: p.project,
      voided: p.journalEntry?.isReversed ?? false,
    })),
  };
}

/** Documents printed for them that this person may open. */
async function documentHistory(c: CompanyContext, id: string, rows: number) {
  const tz = c.company.timezone;
  const types = archiveTypes(c);
  if (types.length === 0) return { total: 0, items: [] };
  const where = { ...visibleDocumentsWhere(c, types), partyId: id };
  const [total, items] = await Promise.all([
    c.db.generatedDocument.count({ where }),
    c.db.generatedDocument.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        documentType: true,
        title: true,
        createdAt: true,
        fileId: true,
        generatedBy: { select: { name: true } },
      },
    }),
  ]);
  return {
    total,
    items: items.map((d) => ({
      id: d.id,
      type: d.documentType as PrintType,
      typeLabel: PRINT_INFO[d.documentType as PrintType].label,
      title: d.title,
      madeOn: localDay(d.createdAt, tz),
      madeBy: d.generatedBy?.name ?? null,
      downloadable: d.fileId !== null,
    })),
  };
}

// =============================================================================
// The view
// =============================================================================

/**
 * One supplier's 360° view (parties.view; accounts that are both buyer and
 * supplier too). Buyers answer "not found".
 */
export async function getSupplier360(
  ctx: CompanyContext,
  partyId: string,
  raw: Supplier360Options = {},
  now: Date = new Date(),
) {
  const options = optionsSchema.parse(raw);
  const party = await ctx.db.party.findUnique({ where: { id: partyId } });
  if (!party || party.kind === "BUYER") throw new AppError("NOT_FOUND", "Supplier not found.");

  const tz = ctx.company.timezone;
  const shows = supplierProfileShows(ctx);
  const liveBills = { supplierId: party.id, status: { not: "VOID" as const } };

  const [balance, billed, open, paid] = await Promise.all([
    getPartyBalance(ctx, party.id),
    shows.money
      ? ctx.db.supplierBill.aggregate({
          where: liveBills,
          _sum: { totalAmount: true },
          _count: { _all: true },
        })
      : null,
    shows.money
      ? ctx.db.supplierBill.aggregate({
          where: { ...liveBills, dueAmount: { gt: 0 } },
          _sum: { dueAmount: true },
          _count: { _all: true },
        })
      : null,
    shows.money
      ? ctx.db.payment.aggregate({
          where: { partyId: party.id, direction: "PAID", ...livePayment },
          _sum: { amount: true },
          _count: { _all: true },
        })
      : null,
  ]);

  const [projects, deliveries, orders, bills, payments, documents] = await Promise.all([
    shows.production
      ? projectLists(ctx, party, shows.money, {
          active: take(options, "active"),
          completed: take(options, "completed"),
        })
      : null,
    deliveryHistory(ctx, party.id, shows, take(options, "deliveries")),
    shows.materials ? orderHistory(ctx, party.id, shows.money, take(options, "orders")) : null,
    shows.money ? billHistory(ctx, party.id, take(options, "bills")) : null,
    shows.money ? paymentHistory(ctx, party.id, take(options, "payments")) : null,
    documentHistory(ctx, party.id, take(options, "documents")),
  ]);

  const figures = {
    /** What the company owes them today: their ledger's balance, when it is in their favour. */
    dueToThem: fixed(balance.lt(0) ? balance.negated() : ZERO),
    /** Money of the company's they hold (an advance), when the balance is the other way. */
    advanceWithThem: fixed(balance.gt(0) ? balance : ZERO),
    billed:
      billed && open
        ? {
            total: fixed(billed._sum.totalAmount ?? ZERO),
            bills: billed._count._all,
            /** What their bills still owe. */
            open: fixed(open._sum.dueAmount ?? ZERO),
            openBills: open._count._all,
          }
        : null,
    paid: paid ? { total: fixed(paid._sum.amount ?? ZERO), payments: paid._count._all } : null,
    projects: projects ? projects.counts : null,
    deliveries: deliveries ? { total: deliveries.total, lastOn: deliveries.lastOn } : null,
  };

  return {
    party: {
      id: party.id,
      code: party.code,
      name: party.name,
      kind: party.kind,
      categories: party.supplierCategories,
      contactPerson: party.contactPerson,
      phone: party.phone,
      email: party.email,
      address: party.address,
      city: party.city,
      country: party.country,
      taxId: party.taxId,
      grade: party.grade,
      status: party.status,
      isVerified: party.isVerified,
      addedOn: localDay(party.createdAt, tz),
    },
    asOf: localDay(now, tz),
    shows,
    figures,
    /** Accessories suppliers run on a continuous ledger, not settled by project. */
    runningLedger: projects?.runningLedger ?? !settledByProject(party.supplierCategories),
    activeProjects: projects?.active ?? null,
    completedProjects: projects?.completed ?? null,
    deliveries,
    orders,
    bills,
    payments,
    documents,
    can: {
      print: mayPrintType(ctx, "SUPPLIER_360"),
      /** Pay them (Accounts): /accounts/supplier-payments/new?supplier=. */
      pay: ctx.can("accounts.payments.record") && party.status !== "CLOSED",
      openPayments: ctx.can("accounts.view") || ctx.can("accounts.payments.record"),
      openProjects: ctx.can("production.view"),
      openOrders: ctx.can("materials.view"),
      openDeliveries: ctx.can("production.view") || ctx.can("production.stock_intake"),
    },
  };
}

export type Supplier360 = Awaited<ReturnType<typeof getSupplier360>>;
