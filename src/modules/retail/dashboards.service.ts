import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  dateColumn,
  dateOnly,
  daysBetween,
  localDay,
  startOfDayInZone,
  weekday,
} from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { accountTotals } from "@/modules/accounts/balances";
import { addDays, monthStart } from "@/modules/accounts/periods";
import { loadAccounts, natural, netProfitFor } from "@/modules/accounts/reports.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { balancesFor } from "@/modules/parties/ledger.service";

import { assertCanSeeStores, canSeeStoreCosts } from "./stores.service";

/*
 * Business dashboards (plan v6 sec 10)
 * ------------------------------------
 * One period at the top (Today, Last 7 days, This week, This month, This year,
 * Lifetime or your own days), compared with the same number of days before.
 * The ERP's side comes from its books; a store's side from the newest daily
 * summaries its site sent, less its fixed costs spread over the days. The same
 * money is never counted twice: total sales take the ERP's sales to its own
 * stores out and put the stores' sales to their customers in.
 */

export const PERIODS = ["today", "7d", "week", "month", "year", "all"] as const;
export type PeriodKey = (typeof PERIODS)[number] | "custom";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const periodSchema = z.object({
  // A wrong value in the address bar falls back to the default, never an error page.
  period: z.enum(PERIODS).optional().catch(undefined),
  from: z.string().regex(DAY_RE).optional().catch(undefined),
  to: z.string().regex(DAY_RE).optional().catch(undefined),
});

type Span = { from: string; to: string; start: Date; end: Date };
export type Period = Span & { key: PeriodKey; previous: Span | null };

const ZERO = new Prisma.Decimal(0);
const LIFETIME_FROM = "2000-01-01";

function span(from: string, to: string, zone: string): Span {
  return {
    from,
    to,
    start: startOfDayInZone(from, zone),
    end: startOfDayInZone(addDays(to, 1), zone),
  };
}

/** The period asked for (this month by default), and the same number of days before it. */
export function periodOf(ctx: CompanyContext, raw: unknown, now = new Date()): Period {
  const q = periodSchema.parse(raw);
  const zone = ctx.company.timezone;
  const today = localDay(now, zone);
  let key: PeriodKey = q.period ?? "month";
  let from: string;
  let to = today;
  if (q.from || q.to) {
    key = "custom";
    from = q.from ?? q.to!;
    to = q.to ?? today;
  } else if (key === "today") from = today;
  else if (key === "7d") from = addDays(today, -6);
  else if (key === "week") from = addDays(today, -((weekday(today) - 6 + 7) % 7));
  else if (key === "year") from = `${today.slice(0, 4)}-01-01`;
  else if (key === "all") from = LIFETIME_FROM;
  else from = monthStart(today);
  if (from > to) throw new AppError("VALIDATION", "'From' is after 'to'.");
  const days = daysBetween(from, to) + 1;
  return {
    key,
    ...span(from, to, zone),
    previous: key === "all" ? null : span(addDays(from, -days), addDays(from, -1), zone),
  };
}

// ---------------------------------------------------------------------------
// A store's own books over days
// ---------------------------------------------------------------------------

type Summary = {
  orders?: { count: number; pieces: number };
  sales?: { gross: number; net: number };
  income?: { deliveryCharges: number };
  deliveries?: { delivered: number; failed: number; returned: number; codPending: number };
  costs: Record<string, number | Record<string, number> | undefined>;
  customers?: { new: number; returning: number };
};

const COSTS = [
  "goods",
  "returnLosses",
  "packaging",
  "delivery",
  "paymentFees",
  "accessories",
  "ads",
  "other",
] as const;
type CostLine = (typeof COSTS)[number] | "fixed";

const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** The newest summaries and the fixed costs of the stores over [from, to] (days up to yesterday). */
export async function storesBooks(storeIds: string[], from: string, to: string, today: string) {
  const last = to < today ? to : addDays(today, -1);
  const books = {
    days: 0,
    netSales: 0,
    grossSales: 0,
    deliveryCharges: 0,
    costs: Object.fromEntries([...COSTS, "fixed"].map((k) => [k, 0])) as Record<CostLine, number>,
    ads: { facebook: 0, instagram: 0, google: 0, tiktok: 0, other: 0 } as Record<string, number>,
    profitBeforeFixed: 0,
    orders: 0,
    pieces: 0,
    customersNew: 0,
    customersReturning: 0,
    delivered: 0,
    failed: 0,
    returned: 0,
    codPending: 0,
    incomplete: [] as string[],
    fixedMissing: [] as string[],
    byDay: new Map<string, number>(),
  };
  if (storeIds.length === 0 || from > last) return { ...books, profit: 0 };
  const rows = await prisma.retailDailySummary.findMany({
    where: { storeId: { in: storeIds }, date: { gte: dateColumn(from), lte: dateColumn(last) } },
    orderBy: [{ date: "asc" }, { version: "asc" }],
  });
  const latest = new Map(rows.map((r) => [`${r.storeId}|${dateOnly(r.date)}`, r]));
  const incomplete = new Set<string>();
  const lastCod = new Map<string, { day: string; cod: number }>();
  for (const r of latest.values()) {
    const s = r.payload as unknown as Summary;
    const day = dateOnly(r.date);
    books.netSales += s.sales?.net ?? 0;
    books.grossSales += s.sales?.gross ?? 0;
    books.deliveryCharges += s.income?.deliveryCharges ?? 0;
    for (const k of COSTS) {
      const v = s.costs[k];
      if (k === "ads" && v && typeof v === "object") {
        for (const [p, a] of Object.entries(v)) {
          books.ads[p] = (books.ads[p] ?? 0) + Number(a);
          books.costs.ads += Number(a);
        }
      } else books.costs[k] += Number(v ?? 0);
    }
    books.profitBeforeFixed += Number(r.netProfit);
    books.byDay.set(day, (books.byDay.get(day) ?? 0) + Number(r.netProfit));
    books.orders += s.orders?.count ?? 0;
    books.pieces += s.orders?.pieces ?? 0;
    books.customersNew += s.customers?.new ?? 0;
    books.customersReturning += s.customers?.returning ?? 0;
    books.delivered += s.deliveries?.delivered ?? 0;
    books.failed += s.deliveries?.failed ?? 0;
    books.returned += s.deliveries?.returned ?? 0;
    const cod = lastCod.get(r.storeId);
    if (!cod || cod.day < day) lastCod.set(r.storeId, { day, cod: s.deliveries?.codPending ?? 0 });
    for (const k of r.incomplete) incomplete.add(k);
  }
  books.codPending = [...lastCod.values()].reduce((t, c) => t + c.cod, 0);
  books.days = new Set([...latest.values()].map((r) => dateOnly(r.date))).size;
  books.incomplete = [...incomplete];

  // Fixed costs: each month's amount shared evenly over its days, from each
  // store's first day sent (or, before any, its first month of fixed costs).
  const [firstSummaries, firstFixed] = await Promise.all([
    prisma.retailDailySummary.groupBy({
      by: ["storeId"],
      where: { storeId: { in: storeIds } },
      _min: { date: true },
    }),
    prisma.retailFixedCost.groupBy({
      by: ["storeId"],
      where: { storeId: { in: storeIds } },
      _min: { month: true },
    }),
  ]);
  const startOf = new Map<string, string>();
  for (const r of firstSummaries) if (r._min.date) startOf.set(r.storeId, dateOnly(r._min.date));
  for (const r of firstFixed) {
    const day = r._min.month ? `${r._min.month}-01` : null;
    if (day && !startOf.has(r.storeId)) startOf.set(r.storeId, day);
  }
  const starts = [...startOf.values()].sort();
  const firstDay = starts[0] ?? addDays(last, 1);
  const fixedFrom = from < firstDay ? firstDay : from;
  const months = new Set<string>();
  for (let d = fixedFrom; d <= last; d = addDays(d, 1)) months.add(d.slice(0, 7));
  const fixedRows = await prisma.retailFixedCost.findMany({
    where: { storeId: { in: storeIds }, month: { in: [...months] } },
    orderBy: { version: "asc" },
  });
  const fixed = new Map(fixedRows.map((f) => [`${f.storeId}|${f.month}`, Number(f.total)]));
  const missing = new Set<string>();
  for (let d = fixedFrom; d <= last; d = addDays(d, 1)) {
    const month = d.slice(0, 7);
    for (const id of storeIds) {
      const start = startOf.get(id);
      if (!start || d < start) continue;
      const total = fixed.get(`${id}|${month}`);
      if (total === undefined) {
        missing.add(month);
        continue;
      }
      const share = total / daysInMonth(month);
      books.costs.fixed += share;
      books.byDay.set(d, (books.byDay.get(d) ?? 0) - share);
    }
  }
  books.fixedMissing = [...missing].sort();
  return { ...books, profit: books.profitBeforeFixed - books.costs.fixed };
}

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
const m2 = (v: number | Prisma.Decimal) => new Prisma.Decimal(v).toFixed(2);

/** What changed between two versions of a day: the figures that moved. */
function changedLines(before: Summary, after: Summary) {
  const flat = (s: Summary) => {
    const out: Record<string, number> = { "sales.net": s.sales?.net ?? 0 };
    for (const k of COSTS) {
      const v = s.costs[k];
      out[`costs.${k}`] =
        v && typeof v === "object"
          ? Object.values(v).reduce((t, a) => t + Number(a), 0)
          : Number(v ?? 0);
    }
    return out;
  };
  const a = flat(before);
  const b = flat(after);
  return Object.keys(b)
    .filter((k) => a[k] !== b[k])
    .map((k) => ({ figure: k, was: m2(a[k] ?? 0), now: m2(b[k] ?? 0) }));
}

/** "Why profit changed": every day and fixed-cost month of the period its site sent again, newest first. */
async function profitChanges(companyId: string, period: Period) {
  const [days, months] = await Promise.all([
    prisma.retailDailySummary.findMany({
      where: {
        companyId,
        date: { gte: dateColumn(period.from), lte: dateColumn(period.to) },
        version: { gt: 1 },
      },
      include: { store: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
    prisma.retailFixedCost.findMany({
      where: {
        companyId,
        month: { gte: period.from.slice(0, 7), lte: period.to.slice(0, 7) },
        version: { gt: 1 },
      },
      include: { store: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
  ]);
  const changes: Array<{
    at: string;
    store: string;
    what: string;
    was: string;
    now: string;
    lines: Array<{ figure: string; was: string; now: string }>;
  }> = [];
  for (const d of days) {
    const before = await prisma.retailDailySummary.findUnique({
      where: { storeId_date_version: { storeId: d.storeId, date: d.date, version: d.version - 1 } },
    });
    if (!before) continue;
    changes.push({
      at: d.receivedAt.toISOString(),
      store: d.store.name,
      what: `Profit of ${dateOnly(d.date)} sent again`,
      was: m2(before.netProfit),
      now: m2(d.netProfit),
      lines: changedLines(before.payload as unknown as Summary, d.payload as unknown as Summary),
    });
  }
  for (const f of months) {
    const before = await prisma.retailFixedCost.findUnique({
      where: {
        storeId_month_version: { storeId: f.storeId, month: f.month, version: f.version - 1 },
      },
    });
    if (!before) continue;
    changes.push({
      at: f.receivedAt.toISOString(),
      store: f.store.name,
      what: `Fixed costs of ${f.month} changed${f.note ? `: ${f.note}` : ""}`,
      was: m2(before.total),
      now: m2(f.total),
      lines: (["salary", "rent", "utilities", "other"] as const)
        .filter((k) => !before[k].equals(f[k]))
        .map((k) => ({ figure: `fixed.${k}`, was: m2(before[k]), now: m2(f[k]) })),
    });
  }
  return changes.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);
}

// ---------------------------------------------------------------------------
// Business > Overview
// ---------------------------------------------------------------------------

/** The ERP's sales (net of returns) and, of them, its sales to its own stores. */
async function erpSales(companyId: string, s: Span, storeParties: string[]) {
  const [row] = await prisma.$queryRaw<
    Array<{ all: Prisma.Decimal | null; shops: Prisma.Decimal | null }>
  >`
    SELECT SUM(jl.credit - jl.debit) AS "all",
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM "JournalLine" ar WHERE ar."entryId" = je.id
          AND ar."partyId" IN (${storeParties.length ? Prisma.join(storeParties) : Prisma.sql`NULL`})
      ) THEN jl.credit - jl.debit ELSE 0 END) AS shops
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE je."companyId" = ${companyId} AND la."subType" = 'SALES'::"AccountSubType"
      AND je.date >= ${s.start} AND je.date < ${s.end}`;
  return { all: Number(row?.all ?? 0), shops: Number(row?.shops ?? 0) };
}

async function overviewFigures(
  ctx: CompanyContext,
  s: Span,
  storeIds: string[],
  parties: string[],
) {
  const today = localDay(new Date(), ctx.company.timezone);
  const [sales, erpProfit, books] = await Promise.all([
    erpSales(ctx.company.id, s, parties),
    netProfitFor(ctx.company.id, { start: s.start, end: s.end }),
    storesBooks(storeIds, s.from, s.to, today),
  ]);
  return {
    totalSales: sales.all - sales.shops + books.netSales,
    erpProfit: Number(erpProfit),
    retailProfit: books.profit,
    totalProfit: Number(erpProfit) + books.profit,
    books,
  };
}

/** Business > Overview: the whole business at a glance. */
export async function overviewPage(ctx: CompanyContext, raw: unknown = {}) {
  if (!canSeeFinancials(ctx)) {
    throw new AppError("FORBIDDEN", "The business overview needs the right to see the financials.");
  }
  const period = periodOf(ctx, raw);
  const stores = await ctx.db.retailStore.findMany({
    select: { id: true, name: true, partyId: true },
  });
  const ids = stores.map((s) => s.id);
  const parties = stores.map((s) => s.partyId);
  const [now, before, accounts, totals, owed, changes, missingStores] = await Promise.all([
    overviewFigures(ctx, period, ids, parties),
    period.previous ? overviewFigures(ctx, period.previous, ids, parties) : null,
    loadAccounts(ctx.company.id),
    accountTotals(ctx.company.id),
    balancesFor(ctx.company.id, parties),
    profitChanges(ctx.company.id, period),
    ctx.can("retail.view") || ctx.can("retail.manage") ? missingDayStores(ctx, stores) : [],
  ]);
  const cash = accounts
    .filter((a) => ["CASH", "BANK", "MOBILE_WALLET"].includes(a.subType))
    .reduce((t, a) => t.plus(natural(a, totals)), ZERO);
  const shopsOwe = [...owed.values()].reduce((t, v) => t.plus(v), ZERO);
  const card = (key: string, label: string, value: number, previous?: number | null) => ({
    key,
    label,
    value: m2(value),
    previous: previous === undefined || previous === null ? null : m2(previous),
    change: previous === undefined || previous === null ? null : m2(value - previous),
  });

  // The chart: each day (or month, for long periods), the ERP's and the stores' profit.
  const long = daysBetween(period.from, period.to) > 62;
  const bucketOf = (day: string) => (long ? day.slice(0, 7) : day);
  const erpByDay = await prisma.$queryRaw<Array<{ day: string; profit: Prisma.Decimal }>>`
    SELECT to_char((je.date AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.company.timezone}, 'YYYY-MM-DD') AS day,
      SUM(jl.credit - jl.debit) AS profit
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE je."companyId" = ${ctx.company.id}
      AND la.type IN ('INCOME'::"AccountType", 'EXPENSE'::"AccountType")
      AND je.date >= ${period.start} AND je.date < ${period.end}
    GROUP BY 1`;
  const buckets = new Map<string, { erp: number; retail: number }>();
  const add = (day: string, k: "erp" | "retail", v: number) => {
    const b = buckets.get(bucketOf(day)) ?? { erp: 0, retail: 0 };
    b[k] += v;
    buckets.set(bucketOf(day), b);
  };
  for (const r of erpByDay) add(r.day, "erp", Number(r.profit));
  for (const [day, v] of now.books.byDay) add(day, "retail", v);
  const chart = [...buckets]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bucket, v]) => ({ bucket, erp: Math.round(v.erp), retail: Math.round(v.retail) }));

  return {
    currency: ctx.company.currency,
    period: { key: period.key, from: period.from, to: period.to },
    cards: [
      card("sales", "Total sales", now.totalSales, before?.totalSales),
      card("profit", "Total profit or loss", now.totalProfit, before?.totalProfit),
      card("erp", "Buying house profit", now.erpProfit, before?.erpProfit),
      card("retail", "Retail profit", now.retailProfit, before?.retailProfit),
      card("cash", "Cash", Number(cash)),
      card("owed", "Shops owe", Number(shopsOwe)),
    ],
    fixedMissing: now.books.fixedMissing,
    incomplete: now.books.incomplete,
    chart,
    changes,
    missingStores,
  };
}

/** The stores with any day's figures missing (up to yesterday, from their first day). */
async function missingDayStores(ctx: CompanyContext, stores: Array<{ id: string; name: string }>) {
  const { storeBooks } = await import("./summaries.service");
  const out: Array<{ id: string; name: string; days: string[] }> = [];
  for (const s of stores) {
    const books = await storeBooks(ctx, s.id);
    if (books.missing.length > 0) out.push({ id: s.id, name: s.name, days: books.missing });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Business > Retail (E-commerce) and a store's own dashboard
// ---------------------------------------------------------------------------

/** One store's figures over a span: its own books and its side in the ERP's books. */
async function storeFigures(ctx: CompanyContext, store: { id: string; partyId: string }, s: Span) {
  const today = localDay(new Date(), ctx.company.timezone);
  const books = await storesBooks([store.id], s.from, s.to, today);
  // The ERP's side: what the store was billed and credited, and the cost of the pieces.
  const [ledger] = await prisma.$queryRaw<
    Array<{ billed: Prisma.Decimal | null; credited: Prisma.Decimal | null }>
  >`
    SELECT SUM(CASE WHEN jl.debit > 0 THEN jl.debit ELSE 0 END) AS billed,
      SUM(CASE WHEN jl.credit > 0 AND je."sourceType" <> 'PAYMENT'::"JournalSource" THEN jl.credit ELSE 0 END) AS credited
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE je."companyId" = ${ctx.company.id} AND jl."partyId" = ${store.partyId}
      AND la."subType" = 'ACCOUNTS_RECEIVABLE'::"AccountSubType"
      AND je."sourceType" IN ('SALE'::"JournalSource", 'RETURN'::"JournalSource", 'RETAIL_EXCHANGE'::"JournalSource")
      AND je.date >= ${s.start} AND je.date < ${s.end}`;
  const orders = await ctx.db.retailOrder.findMany({
    where: { storeId: store.id },
    select: { orderId: true },
  });
  const pieces = await ctx.db.retailReturnPiece.findMany({
    where: { parcel: { order: { storeId: store.id } } },
    select: { id: true, salesReturnId: true, status: true, price: true, decidedAt: true },
  });
  // Approved pieces go back through a sales return: its stock comes in per return item.
  const returnItems = await ctx.db.salesReturnItem.findMany({
    where: { returnId: { in: [...new Set(pieces.flatMap((p) => p.salesReturnId ?? []))] } },
    select: { id: true },
  });
  const [out, back] = await Promise.all([
    ctx.db.stockMovement.findMany({
      where: {
        type: "SALE_OUT",
        referenceType: "SalesOrder",
        referenceId: { in: orders.map((o) => o.orderId) },
        createdAt: { gte: s.start, lt: s.end },
      },
      select: { quantity: true, unitCost: true },
    }),
    ctx.db.stockMovement.findMany({
      where: {
        type: "RETURN_RESTOCK",
        createdAt: { gte: s.start, lt: s.end },
        OR: [
          { referenceType: "RetailReturnPiece", referenceId: { in: pieces.map((p) => p.id) } },
          { referenceType: "SalesReturnItem", referenceId: { in: returnItems.map((i) => i.id) } },
        ],
      },
      select: { quantity: true, unitCost: true },
    }),
  ]);
  const cost = (rows: Array<{ quantity: number; unitCost: Prisma.Decimal | null }>) =>
    rows.reduce((t, r) => t + Math.abs(r.quantity) * Number(r.unitCost ?? 0), 0);
  const billed = Number(ledger?.billed ?? 0);
  const credited = Number(ledger?.credited ?? 0);
  const storeLoss = pieces
    .filter(
      (p) =>
        p.status === "DECLINED" && p.decidedAt && p.decidedAt >= s.start && p.decidedAt < s.end,
    )
    .reduce((t, p) => t + Number(p.price), 0);
  const allCosts = Object.values(books.costs).reduce((t, v) => t + v, 0);
  const sent = books.delivered + books.failed + books.returned;
  return {
    sales: books.netSales,
    costs: allCosts,
    profit: books.profit,
    margin: pct(books.profit, books.netSales),
    costSplit: (Object.entries(books.costs) as Array<[CostLine, number]>).map(([line, v]) => ({
      line,
      amount: m2(v),
      share: pct(v, allCosts),
    })),
    ads: {
      spend: books.costs.ads,
      byPlatform: books.ads,
      roas: books.costs.ads > 0 ? Math.round((books.netSales / books.costs.ads) * 100) / 100 : null,
      perNewCustomer: books.customersNew > 0 ? books.costs.ads / books.customersNew : null,
    },
    customers: {
      new: books.customersNew,
      returning: books.customersReturning,
      repeatRate: pct(books.customersReturning, books.customersNew + books.customersReturning),
      perOrder: books.orders > 0 ? books.netSales / books.orders : null,
    },
    delivery: {
      successRate: pct(books.delivered, sent),
      returnRate: pct(books.returned, sent),
      codPending: books.codPending,
    },
    erp: {
      taken: billed,
      givenBack: credited,
      storeLoss,
      erpProfit: billed - credited - (cost(out) - cost(back)),
    },
    incomplete: books.incomplete,
    fixedMissing: books.fixedMissing,
    days: books.days,
  };
}

const view = (f: Awaited<ReturnType<typeof storeFigures>>) => ({
  ...f,
  sales: m2(f.sales),
  costs: m2(f.costs),
  profit: m2(f.profit),
  ads: {
    ...f.ads,
    spend: m2(f.ads.spend),
    byPlatform: Object.fromEntries(Object.entries(f.ads.byPlatform).map(([k, v]) => [k, m2(v)])),
    perNewCustomer: f.ads.perNewCustomer === null ? null : m2(f.ads.perNewCustomer),
  },
  customers: {
    ...f.customers,
    perOrder: f.customers.perOrder === null ? null : m2(f.customers.perOrder),
  },
  delivery: { ...f.delivery, codPending: m2(f.delivery.codPending) },
  erp: {
    taken: m2(f.erp.taken),
    givenBack: m2(f.erp.givenBack),
    storeLoss: m2(f.erp.storeLoss),
    erpProfit: m2(f.erp.erpProfit),
  },
});

/** A store's own dashboard (its page), with the period before for the main numbers. */
export async function storeDashboard(ctx: CompanyContext, storeId: string, raw: unknown = {}) {
  assertCanSeeStores(ctx);
  const store = await ctx.db.retailStore.findUnique({ where: { id: storeId } });
  if (!store) throw new AppError("NOT_FOUND", "There is no such store.");
  const period = periodOf(ctx, raw);
  const [now, before] = await Promise.all([
    storeFigures(ctx, store, period),
    period.previous ? storeFigures(ctx, store, period.previous) : null,
  ]);
  const costs = canSeeStoreCosts(ctx);
  const v = view(now);
  return {
    period: { key: period.key, from: period.from, to: period.to },
    ...v,
    erp: costs ? v.erp : null,
    previous: before
      ? { sales: m2(before.sales), profit: m2(before.profit), costs: m2(before.costs) }
      : null,
    ...(await bestOf(ctx, store.id, period)),
  };
}

/** The best-selling styles and the best customers of a store in a period, and styles left lying. */
async function bestOf(ctx: CompanyContext, storeId: string, s: Span) {
  const lines = await ctx.db.retailOrderLine.findMany({
    where: {
      cancelledAt: null,
      replacesLineId: null,
      order: { storeId, billedAt: { gte: s.start, lt: s.end } },
    },
    select: {
      quantity: true,
      customerPrice: true,
      variant: { select: { styleId: true, style: { select: { code: true, name: true } } } },
      order: { select: { order: { select: { customerName: true, customerPhone: true } } } },
    },
  });
  const styles = new Map<string, { style: string; pieces: number }>();
  const customers = new Map<string, { name: string; phone: string; spent: number }>();
  for (const l of lines) {
    const st = styles.get(l.variant.styleId) ?? {
      style: `${l.variant.style.code} ${l.variant.style.name}`,
      pieces: 0,
    };
    st.pieces += l.quantity;
    styles.set(l.variant.styleId, st);
    const c = l.order.order;
    const key = c.customerPhone ?? c.customerName ?? "";
    if (!key) continue;
    const cu = customers.get(key) ?? {
      name: c.customerName ?? "",
      phone: c.customerPhone ?? "",
      spent: 0,
    };
    cu.spent += Number(l.customerPrice) * l.quantity;
    customers.set(key, cu);
  }
  // Styles the store took before but not in the last 30 days, with stock left.
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const recent = await ctx.db.retailOrderLine.findMany({
    where: { order: { storeId, billedAt: { not: null } } },
    select: { variant: { select: { styleId: true } }, order: { select: { billedAt: true } } },
  });
  const lastTaken = new Map<string, Date>();
  for (const r of recent) {
    const at = r.order.billedAt!;
    const was = lastTaken.get(r.variant.styleId);
    if (!was || was < at) lastTaken.set(r.variant.styleId, at);
  }
  const idleIds = [...lastTaken].filter(([, at]) => at < since).map(([id]) => id);
  const idle = idleIds.length
    ? await ctx.db.style.findMany({
        where: {
          id: { in: idleIds },
          variants: { some: { stockBalances: { some: { quantity: { gt: 0 } } } } },
        },
        select: { code: true, name: true },
        take: 10,
      })
    : [];
  return {
    topStyles: [...styles.values()].sort((a, b) => b.pieces - a.pieces).slice(0, 10),
    topCustomers: [...customers.values()]
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 10)
      .map((c) => ({ ...c, spent: m2(c.spent) })),
    lyingStyles: idle.map((st) => `${st.code} ${st.name}`),
  };
}

/** Business > Retail, E-commerce: every online store together, and side by side. */
export async function ecommercePage(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSeeStores(ctx);
  const period = periodOf(ctx, raw);
  const stores = await ctx.db.retailStore.findMany({
    where: { kind: "ONLINE" },
    select: { id: true, name: true, partyId: true, closedAt: true },
    orderBy: { name: "asc" },
  });
  const owed = await balancesFor(
    ctx.company.id,
    stores.map((s) => s.partyId),
  );
  const rows = [];
  for (const s of stores) {
    const f = await storeFigures(ctx, s, period);
    rows.push({
      id: s.id,
      name: s.name,
      closed: s.closedAt !== null,
      sales: m2(f.sales),
      profit: m2(f.profit),
      margin: f.margin,
      owes: m2(owed.get(s.partyId) ?? ZERO),
      incomplete: f.incomplete,
    });
  }
  const today = localDay(new Date(), ctx.company.timezone);
  const ids = stores.map((s) => s.id);
  const [all, before] = await Promise.all([
    storesBooks(ids, period.from, period.to, today),
    period.previous ? storesBooks(ids, period.previous.from, period.previous.to, today) : null,
  ]);
  return {
    currency: ctx.company.currency,
    period: { key: period.key, from: period.from, to: period.to },
    totals: {
      sales: m2(all.netSales),
      profit: m2(all.profit),
      margin: pct(all.profit, all.netSales),
      orders: all.orders,
      previousSales: before ? m2(before.netSales) : null,
      previousProfit: before ? m2(before.profit) : null,
    },
    fixedMissing: all.fixedMissing,
    incomplete: all.incomplete,
    stores: rows,
  };
}

export type OverviewPage = Awaited<ReturnType<typeof overviewPage>>;
export type EcommercePage = Awaited<ReturnType<typeof ecommercePage>>;
export type StoreDashboard = Awaited<ReturnType<typeof storeDashboard>>;
