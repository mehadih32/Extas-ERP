import { z } from "zod";

import { localDay } from "@/lib/dates";
import { formatDay, formatMonth } from "@/lib/display";
import { AppError } from "@/lib/errors";
import { formatAmount } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { buildXlsx, type XlsxCell, type XlsxSheet } from "@/lib/xlsx";
import { addDays } from "@/modules/accounts/periods";
import { netProfitFor } from "@/modules/accounts/reports.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterheadOf } from "@/modules/documents/builders";
import { type Block, documentFileName, type PrintDocument } from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";
import { renderDocumentPdf } from "@/modules/documents/render";
import { readStoredFile } from "@/modules/files/file.service";

import { accountOf } from "./account.service";
import {
  ecommercePage,
  overviewPage,
  type Period,
  periodOf,
  storeDashboard,
  storesBooks,
} from "./dashboards.service";
import { assertCanSeeStores } from "./stores.service";
import { storeBooks } from "./summaries.service";

/*
 * Downloads from the Business pages (plan v6 sec 12): Overview, Retail
 * (E-commerce, POS) or one store, for a period, with the parts the person
 * ticks, as a PDF to print or an Excel workbook to check. A store's report is
 * on the store's own pad (its name, logo, address and phone); the others on the
 * company's. Made when asked for, never kept (the year-end summaries are kept,
 * year-reports.service.ts), and every download is in the activity log.
 */

export const REPORT_PARTS = [
  "summary",
  "profit",
  "months",
  "chart",
  "sales",
  "customers",
  "ads",
  "returns",
  "statement",
  "days",
] as const;
export type ReportPart = (typeof REPORT_PARTS)[number];

/** The ready-made choice for a bank: the summary, profit and loss, by month and the statement. */
export const BANK_REPORT: ReportPart[] = ["summary", "profit", "months", "statement"];

const SCOPES = ["overview", "ecommerce", "pos", "store"] as const;

const requestSchema = z.object({
  scope: z.enum(SCOPES),
  storeId: z.string().min(1).optional(),
  period: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  parts: z.array(z.enum(REPORT_PARTS)).min(1, "Tick at least one part."),
  format: z.enum(["pdf", "xlsx"]),
});

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Kind = "text" | "money" | "int" | "percent";
type Cell = string | number | null;
/** One part of a report, laid out the same way in the PDF and in Excel. */
type Part = {
  key: ReportPart;
  title: string;
  figures?: Array<{ label: string; value: string }>;
  table?: { columns: Array<{ label: string; kind: Kind }>; rows: Cell[][]; total?: boolean };
  bars?: { series: [string] | [string, string]; rows: Array<{ label: string; values: number[] }> };
  note?: string;
};

export type Report = {
  title: string;
  subtitle: string;
  from: string;
  to: string;
  parts: Part[];
  store: { id: string; name: string; address: string | null; phone: string | null } | null;
};

const num = (v: string | number | null | undefined) =>
  v === null || v === undefined ? 0 : Number(v);

// ---------------------------------------------------------------------------
// The figures, by month and by day
// ---------------------------------------------------------------------------

/**
 * The months of a period, oldest first; for Lifetime from the stores' first day
 * (or the company's first journal entry, with the ERP's side). At most 120.
 */
async function monthsOf(ctx: CompanyContext, storeIds: string[], p: Period, withErp: boolean) {
  let from = p.from;
  if (p.key === "all") {
    const [first, entry] = await Promise.all([
      prisma.retailDailySummary.findFirst({
        where: { storeId: { in: storeIds } },
        orderBy: { date: "asc" },
        select: { date: true },
      }),
      withErp
        ? prisma.journalEntry.findFirst({
            where: { companyId: ctx.company.id },
            orderBy: { date: "asc" },
            select: { date: true },
          })
        : null,
    ]);
    const days = [
      first?.date.toISOString().slice(0, 10),
      entry ? localDay(entry.date, ctx.company.timezone) : undefined,
    ].filter((d): d is string => Boolean(d));
    from = days.length ? days.sort()[0]! : p.to;
  }
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= p.to.slice(0, 7) && months.length < 120; m = nextMonth(m)) {
    months.push(m);
  }
  return months.map((month) => {
    const start = month === from.slice(0, 7) ? from : `${month}-01`;
    const end = addDays(`${nextMonth(month)}-01`, -1);
    return { month, from: start, to: end < p.to ? end : p.to };
  });
}
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

async function monthTable(ctx: CompanyContext, storeIds: string[], p: Period, withErp: boolean) {
  const today = localDay(new Date(), ctx.company.timezone);
  const rows = [];
  for (const m of await monthsOf(ctx, storeIds, p, withErp)) {
    const books = await storesBooks(storeIds, m.from, m.to, today);
    const span = periodOf(ctx, { from: m.from, to: m.to });
    const erp = withErp
      ? Number(await netProfitFor(ctx.company.id, { start: span.start, end: span.end }))
      : 0;
    rows.push({ month: m.month, sales: books.netSales, retail: books.profit, erp });
  }
  return rows;
}

/** Every day's newest figures, one row per store and day (Excel only). */
async function dayRows(storeIds: string[], p: Period) {
  const rows = await prisma.retailDailySummary.findMany({
    where: {
      storeId: { in: storeIds },
      date: { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) },
    },
    include: { store: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { version: "asc" }],
  });
  const newest = new Map(rows.map((r) => [`${r.storeId}|${r.date.toISOString()}`, r]));
  return [...newest.values()].map((r) => {
    const s = r.payload as {
      orders?: { count: number };
      sales?: { net: number };
      costs: Record<string, number | Record<string, number> | undefined>;
    };
    const costs = Object.values(s.costs).reduce<number>(
      (t, v) =>
        t +
        (v && typeof v === "object"
          ? Object.values(v).reduce((a, b) => a + Number(b), 0)
          : Number(v ?? 0)),
      0,
    );
    return [
      r.date.toISOString().slice(0, 10),
      r.store.name,
      s.orders?.count ?? null,
      s.sales?.net ?? null,
      costs,
      Number(r.netProfit),
      r.version,
      r.incomplete.join(", "),
    ] as Cell[];
  });
}

// ---------------------------------------------------------------------------
// The report of each page
// ---------------------------------------------------------------------------

const rate = (v: number | null) => (v === null ? "-" : `${v}%`);

async function buildReport(
  ctx: CompanyContext,
  scope: (typeof SCOPES)[number],
  storeId: string | undefined,
  raw: { period?: string; from?: string; to?: string },
  picked: ReportPart[],
): Promise<Report> {
  const p = periodOf(ctx, raw);
  const cur = ctx.company.currency;
  const m = (v: string | number) => formatAmount(String(v), 2, cur);
  const want = new Set(picked);
  const parts: Part[] = [];
  const range = `${formatDay(p.from)} to ${formatDay(p.to)}`;

  if (scope === "pos") {
    assertCanSeeStores(ctx);
    if (want.has("summary")) {
      parts.push({ key: "summary", title: "Summary", note: "No showrooms yet." });
    }
    return { title: "POS report", subtitle: range, from: p.from, to: p.to, parts, store: null };
  }

  if (scope === "overview") {
    const o = await overviewPage(ctx, raw);
    const stores = await ctx.db.retailStore.findMany({ select: { id: true } });
    const ids = stores.map((s) => s.id);
    const card = (k: string) => o.cards.find((c) => c.key === k)!;
    if (want.has("summary")) {
      parts.push({
        key: "summary",
        title: "Summary",
        figures: o.cards.map((c) => ({ label: c.label, value: m(c.value) })),
      });
    }
    if (want.has("profit")) {
      parts.push({
        key: "profit",
        title: "Profit and loss",
        table: {
          columns: [
            { label: "Business", kind: "text" },
            { label: `This period (${cur})`, kind: "money" },
            { label: `The period before (${cur})`, kind: "money" },
          ],
          rows: ["erp", "retail", "profit"].map((k) => [
            card(k).label,
            num(card(k).value),
            card(k).previous === null ? null : num(card(k).previous),
          ]),
          total: true,
        },
      });
    }
    if (want.has("months") || want.has("chart")) {
      const months = await monthTable(ctx, ids, p, true);
      if (want.has("months")) {
        parts.push({
          key: "months",
          title: "By month",
          table: {
            columns: [
              { label: "Month", kind: "text" },
              { label: `Buying house profit (${cur})`, kind: "money" },
              { label: `Retail profit (${cur})`, kind: "money" },
              { label: `Total (${cur})`, kind: "money" },
            ],
            rows: months.map((r) => [formatMonth(r.month), r.erp, r.retail, r.erp + r.retail]),
          },
        });
      }
      if (want.has("chart")) {
        parts.push({
          key: "chart",
          title: "Profit by business",
          bars: {
            series: ["Buying house", "Retail"],
            rows: o.chart.map((r) => ({ label: r.bucket, values: [r.erp, r.retail] })),
          },
        });
      }
    }
    if (o.changes.length > 0 && want.has("summary")) {
      parts.push({
        key: "summary",
        title: "Why profit changed",
        table: {
          columns: [
            { label: "Store", kind: "text" },
            { label: "What", kind: "text" },
            { label: `Was (${cur})`, kind: "money" },
            { label: `Now (${cur})`, kind: "money" },
          ],
          rows: o.changes.map((c) => [c.store, c.what, num(c.was), num(c.now)]),
        },
      });
    }
    const retail = await retailParts(ctx, p, want, m, cur);
    parts.push(...retail);
    return {
      title: "Business report",
      subtitle: range,
      from: p.from,
      to: p.to,
      parts,
      store: null,
    };
  }

  if (scope === "ecommerce") {
    const e = await ecommercePage(ctx, raw);
    if (want.has("summary")) {
      parts.push({
        key: "summary",
        title: "Summary",
        figures: [
          { label: "Net sales", value: m(e.totals.sales) },
          { label: "Profit or loss", value: m(e.totals.profit) },
          { label: "Profit rate", value: rate(e.totals.margin) },
          { label: "Orders", value: String(e.totals.orders) },
        ],
      });
      parts.push({
        key: "summary",
        title: "Stores side by side",
        table: {
          columns: [
            { label: "Store", kind: "text" },
            { label: `Net sales (${cur})`, kind: "money" },
            { label: `Profit or loss (${cur})`, kind: "money" },
            { label: "Profit rate", kind: "text" },
            { label: `Owes the ERP (${cur})`, kind: "money" },
          ],
          rows: e.stores.map((s) => [
            s.name,
            num(s.sales),
            num(s.profit),
            rate(s.margin),
            num(s.owes),
          ]),
        },
      });
    }
    parts.push(...(await retailParts(ctx, p, want, m, cur, "ONLINE")));
    return {
      title: "E-commerce report",
      subtitle: range,
      from: p.from,
      to: p.to,
      parts,
      store: null,
    };
  }

  // One store.
  if (!storeId) throw new AppError("VALIDATION", "Which store?");
  const d = await storeDashboard(ctx, storeId, raw);
  const store = await ctx.db.retailStore.findUniqueOrThrow({
    where: { id: storeId },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      partyId: true,
      holdReleasedUntil: true,
      holdReleaseReason: true,
    },
  });
  if (want.has("summary")) {
    parts.push({
      key: "summary",
      title: "Summary",
      figures: [
        { label: "Net sales", value: m(d.sales) },
        { label: "Costs", value: m(d.costs) },
        { label: "Profit or loss", value: m(d.profit) },
        { label: "Profit rate", value: rate(d.margin) },
      ],
    });
  }
  if (want.has("profit")) {
    parts.push({
      key: "profit",
      title: "Profit and loss",
      table: {
        columns: [
          { label: "Line", kind: "text" },
          { label: `Amount (${cur})`, kind: "money" },
          { label: "Share of costs", kind: "text" },
        ],
        rows: [
          ["Net sales", num(d.sales), ""],
          ...d.costSplit.map((c) => [COST[c.line] ?? c.line, -num(c.amount), rate(c.share)]),
          ["Profit or loss", num(d.profit), ""],
        ],
        total: true,
      },
    });
  }
  if (want.has("months") || want.has("chart")) {
    const months = await monthTable(ctx, [store.id], p, false);
    if (want.has("months")) {
      parts.push({
        key: "months",
        title: "By month",
        table: {
          columns: [
            { label: "Month", kind: "text" },
            { label: `Net sales (${cur})`, kind: "money" },
            { label: `Profit or loss (${cur})`, kind: "money" },
          ],
          rows: months.map((r) => [formatMonth(r.month), r.sales, r.retail]),
        },
      });
    }
    if (want.has("chart")) {
      parts.push({
        key: "chart",
        title: "Profit by month",
        bars: {
          series: ["Profit or loss"],
          rows: months.map((r) => ({
            label: formatMonth(r.month),
            values: [Math.round(r.retail)],
          })),
        },
      });
    }
  }
  if (want.has("sales")) {
    parts.push({
      key: "sales",
      title: "Best-selling styles",
      table: {
        columns: [
          { label: "Style", kind: "text" },
          { label: "Pieces", kind: "int" },
        ],
        rows: d.topStyles.map((s) => [s.style, s.pieces]),
      },
      note:
        d.lyingStyles.length > 0
          ? `Styles lying unsold for 30 days: ${d.lyingStyles.join(", ")}`
          : undefined,
    });
  }
  if (want.has("customers")) {
    parts.push({
      key: "customers",
      title: "Customers",
      figures: [
        { label: "New", value: String(d.customers.new) },
        { label: "Came back", value: String(d.customers.returning) },
        { label: "Bought again", value: rate(d.customers.repeatRate) },
        {
          label: "Money per order",
          value: d.customers.perOrder === null ? "-" : m(d.customers.perOrder),
        },
      ],
      table: {
        columns: [
          { label: "Best customers", kind: "text" },
          { label: "Phone", kind: "text" },
          { label: `Spent (${cur})`, kind: "money" },
        ],
        rows: d.topCustomers.map((c) => [c.name, c.phone, num(c.spent)]),
      },
    });
  }
  if (want.has("ads")) {
    const books = await storeBooks(ctx, store.id);
    parts.push({
      key: "ads",
      title: "Ads and budget",
      figures: [
        { label: "Ads spent", value: m(d.ads.spend) },
        { label: "ROAS", value: d.ads.roas === null ? "-" : String(d.ads.roas) },
        {
          label: "Ads cost of a new customer",
          value: d.ads.perNewCustomer === null ? "-" : m(d.ads.perNewCustomer),
        },
      ],
      table: {
        columns: [
          { label: `Budget, ${formatMonth(books.month)}`, kind: "text" },
          { label: `Spent (${cur})`, kind: "money" },
          { label: `Budget (${cur})`, kind: "money" },
        ],
        rows: books.budget.map((b) => [
          BUDGET[b.line] ?? b.line,
          num(b.spent),
          b.budget === null ? null : num(b.budget),
        ]),
      },
    });
  }
  if (want.has("returns")) {
    parts.push({
      key: "returns",
      title: "Returns and delivery",
      figures: [
        { label: "Delivered", value: rate(d.delivery.successRate) },
        { label: "Came back", value: rate(d.delivery.returnRate) },
        { label: "Cash on delivery not in yet", value: m(d.delivery.codPending) },
        ...(d.erp
          ? [
              { label: "Taken from the ERP", value: m(d.erp.taken) },
              { label: "Given back to the ERP", value: m(d.erp.givenBack) },
              { label: "The store's loss on returns", value: m(d.erp.storeLoss) },
              { label: "The ERP's profit from the store", value: m(d.erp.erpProfit) },
            ]
          : []),
      ],
    });
  }
  if (want.has("statement")) {
    const a = await accountOf(ctx, store, { from: p.from, to: p.to });
    parts.push({
      key: "statement",
      title: "Statement",
      figures: a.period
        ? [
            { label: "Opening balance", value: m(a.period.openingBalance) },
            { label: "Bills", value: m(a.period.ordersTotal) },
            { label: "Credits", value: m(a.period.creditsTotal) },
            { label: "Payments", value: m(a.period.paymentsTotal) },
            { label: "Closing balance", value: m(a.period.closingBalance) },
          ]
        : [],
      table: {
        columns: [
          { label: "Date", kind: "text" },
          { label: "Number", kind: "text" },
          { label: "What", kind: "text" },
          { label: `Amount (${cur})`, kind: "money" },
        ],
        rows: a.statement.map((l) => [
          formatDay(l.date),
          l.number,
          STATEMENT[l.kind] ?? l.kind,
          l.kind === "PAYMENT" || l.kind === "CREDIT" ? -l.amount : l.amount,
        ]),
      },
    });
  }
  if (want.has("days")) {
    parts.push(dayPart(await dayRows([store.id], p), cur));
  }
  return {
    title: "Store report",
    subtitle: range,
    from: p.from,
    to: p.to,
    parts,
    store: { id: store.id, name: store.name, address: store.address, phone: store.phone },
  };
}

const COST: Record<string, string> = {
  goods: "Goods",
  returnLosses: "Return losses",
  packaging: "Packaging",
  delivery: "Delivery",
  paymentFees: "Payment fees",
  accessories: "Accessories",
  ads: "Ads",
  other: "Other",
  fixed: "Fixed costs",
};
const BUDGET: Record<string, string> = {
  ads: "Ads",
  packaging: "Packaging",
  delivery: "Delivery",
  salary: "Salary",
  other: "Other",
};
const STATEMENT: Record<string, string> = {
  BILL: "Bill",
  CREDIT: "Credit",
  PAYMENT: "Payment",
  EXCHANGE: "Exchange",
  OTHER: "Other",
};

function dayPart(rows: Cell[][], cur: string): Part {
  return {
    key: "days",
    title: "Every day",
    table: {
      columns: [
        { label: "Day", kind: "text" },
        { label: "Store", kind: "text" },
        { label: "Orders", kind: "int" },
        { label: `Net sales (${cur})`, kind: "money" },
        { label: `Costs (${cur})`, kind: "money" },
        { label: `Profit (${cur})`, kind: "money" },
        { label: "Sent", kind: "int" },
        { label: "Not complete yet", kind: "text" },
      ],
      rows,
    },
  };
}

/** The online stores together: customers, ads, returns, the stores' debts and every day. */
async function retailParts(
  ctx: CompanyContext,
  p: Period,
  want: Set<ReportPart>,
  m: (v: string | number) => string,
  cur: string,
  /** Only the online stores (the E-commerce page), or every store. */
  kind?: "ONLINE",
): Promise<Part[]> {
  const stores = await ctx.db.retailStore.findMany({
    where: kind ? { kind } : {},
    select: { id: true, name: true, partyId: true },
    orderBy: { name: "asc" },
  });
  const ids = stores.map((s) => s.id);
  const today = localDay(new Date(), ctx.company.timezone);
  const b = await storesBooks(ids, p.from, p.to, today);
  const parts: Part[] = [];
  const pct = (a: number, w: number) => (w > 0 ? `${Math.round((a / w) * 1000) / 10}%` : "-");
  if (want.has("sales")) {
    parts.push({
      key: "sales",
      title: "Retail sales",
      figures: [
        { label: "Orders", value: String(b.orders) },
        { label: "Pieces", value: String(b.pieces) },
        { label: "Net sales", value: m(b.netSales) },
      ],
    });
  }
  if (want.has("customers")) {
    parts.push({
      key: "customers",
      title: "Customers",
      figures: [
        { label: "New", value: String(b.customersNew) },
        { label: "Came back", value: String(b.customersReturning) },
        {
          label: "Bought again",
          value: pct(b.customersReturning, b.customersNew + b.customersReturning),
        },
      ],
    });
  }
  if (want.has("ads")) {
    parts.push({
      key: "ads",
      title: "Ads",
      figures: [
        { label: "Ads spent", value: m(b.costs.ads) },
        {
          label: "ROAS",
          value: b.costs.ads > 0 ? String(Math.round((b.netSales / b.costs.ads) * 100) / 100) : "-",
        },
      ],
    });
  }
  if (want.has("returns")) {
    const sent = b.delivered + b.failed + b.returned;
    parts.push({
      key: "returns",
      title: "Returns and delivery",
      figures: [
        { label: "Delivered", value: pct(b.delivered, sent) },
        { label: "Came back", value: pct(b.returned, sent) },
        { label: "Cash on delivery not in yet", value: m(b.codPending) },
      ],
    });
  }
  if (want.has("statement")) {
    const { balancesFor } = await import("@/modules/parties/ledger.service");
    const owed = await balancesFor(
      ctx.company.id,
      stores.map((s) => s.partyId),
    );
    parts.push({
      key: "statement",
      title: "What the stores owe",
      table: {
        columns: [
          { label: "Store", kind: "text" },
          { label: `Owes the ERP today (${cur})`, kind: "money" },
        ],
        rows: stores.map((s) => [s.name, num(owed.get(s.partyId)?.toString())]),
        total: true,
      },
    });
  }
  if (want.has("days")) parts.push(dayPart(await dayRows(ids, p), cur));
  return parts;
}

// ---------------------------------------------------------------------------
// PDF and Excel
// ---------------------------------------------------------------------------

function cellText(v: Cell, kind: Kind, cur: string) {
  if (v === null) return "-";
  if (kind === "money") return formatAmount(String(v), 2, cur);
  if (kind === "percent") return `${v}%`;
  return String(v);
}

export function reportDocument(ctx: CompanyContext, r: Report): PrintDocument {
  const cur = ctx.company.currency;
  const blocks: Block[] = [];
  for (const part of r.parts) {
    if (part.key === "days") {
      blocks.push({ kind: "note", text: "Every day's figures are in the Excel file." });
      continue;
    }
    if (part.figures?.length) blocks.push({ kind: "figures", figures: part.figures });
    if (part.table) {
      const t = part.table;
      blocks.push({
        kind: "table",
        title: part.title,
        columns: t.columns.map((c, i) => ({
          label: c.label,
          align: c.kind === "text" ? "left" : "right",
          weight: i === 0 ? 2 : 1.2,
        })),
        rows: t.rows.map((row, i) => ({
          cells: row.map((v, k) => cellText(v, t.columns[k]!.kind, cur)),
          style: t.total && i === t.rows.length - 1 ? "total" : "normal",
        })),
        empty: "Nothing in this period.",
      });
    } else if (!part.bars && !part.figures?.length && !part.note) {
      blocks.push({ kind: "note", text: `${part.title}: nothing in this period.` });
    }
    if (part.bars) {
      blocks.push(
        part.bars.rows.length > 0
          ? { kind: "bars", title: part.title, series: part.bars.series, rows: part.bars.rows }
          : { kind: "note", text: `${part.title}: nothing in this period.` },
      );
    }
    if (part.note) blocks.push({ kind: "note", text: part.note });
  }
  const letterhead = r.store
    ? {
        ...letterheadOf(ctx.company),
        name: r.store.name,
        legalName: null,
        contacts: [r.store.address, r.store.phone].filter((l): l is string => Boolean(l)),
        footer: r.store.name,
      }
    : letterheadOf(ctx.company);
  return {
    type: "RETAIL_REPORT",
    title: r.title,
    subtitle: r.subtitle,
    reference: `${r.store?.name ?? ctx.company.name} ${r.from} to ${r.to}`,
    letterhead,
    meta: [
      { label: "From", value: formatDay(r.from) },
      { label: "To", value: formatDay(r.to) },
      { label: "Made on", value: formatDay(localDay(new Date(), ctx.company.timezone)) },
    ],
    parties: [],
    blocks,
    signatures: [],
  };
}

export function reportWorkbook(ctx: CompanyContext, r: Report): Buffer {
  const cur = ctx.company.currency;
  const used = new Set<string>();
  const sheets: XlsxSheet[] = [];
  for (const part of r.parts) {
    let name = part.title.slice(0, 28);
    for (let n = 2; used.has(name); n++) name = `${part.title.slice(0, 25)} ${n}`;
    used.add(name);
    const rows: XlsxCell[][] = [
      [{ value: `${r.store?.name ?? ctx.company.name}: ${part.title}`, style: "title" }],
      [{ value: r.subtitle, style: "note" }],
      [],
    ];
    for (const f of part.figures ?? [])
      rows.push([{ value: f.label, style: "bold" }, { value: f.value }]);
    if (part.figures?.length) rows.push([]);
    const t =
      part.table ??
      (part.bars
        ? {
            columns: [
              { label: "When", kind: "text" as Kind },
              ...part.bars.series.map((s) => ({ label: `${s} (${cur})`, kind: "money" as Kind })),
            ],
            rows: part.bars.rows.map((b) => [b.label, ...b.values]),
          }
        : null);
    let headerRow = 0;
    if (t) {
      rows.push(t.columns.map((c) => ({ value: c.label, style: "header" as const })));
      headerRow = rows.length;
      for (const [i, row] of t.rows.entries()) {
        const total = "total" in t && t.total && i === t.rows.length - 1;
        rows.push(
          row.map((v, k) => {
            const kind = t.columns[k]!.kind;
            if (v === null) return { value: null };
            if (typeof v === "number" && kind === "money")
              return { value: v, style: total ? ("totalMoney" as const) : ("money" as const) };
            if (typeof v === "number" && kind === "int")
              return { value: v, style: total ? ("totalInt" as const) : ("int" as const) };
            return { value: String(v), style: total ? ("totalText" as const) : undefined };
          }),
        );
      }
    }
    if (part.note) rows.push([], [{ value: part.note, style: "note" }]);
    sheets.push({
      name,
      rows,
      widths: [34, 18, 18, 18, 18, 18, 10, 24],
      freezeRows: headerRow || undefined,
      filter:
        t && part.key === "days"
          ? { firstRow: headerRow, lastRow: headerRow + t.rows.length, columns: t.columns.length }
          : undefined,
    });
  }
  return Buffer.from(
    buildXlsx(sheets, {
      title: `${r.store?.name ?? ctx.company.name}: ${r.title} (${r.from} to ${r.to})`,
      creator: ctx.user.name,
      created: new Date(),
      headerColor: ctx.company.primaryColor,
    }),
  );
}

/** The store's logo for its pad, when it has one whose bytes are still the checked ones. */
async function storeLogo(storeId: string) {
  const store = await prisma.retailStore.findUnique({
    where: { id: storeId },
    select: { logoFile: true },
  });
  if (!store?.logoFile?.checksum) return null;
  const bytes = await readStoredFile(store.logoFile).catch(() => null);
  if (!bytes) return null;
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex") === store.logoFile.checksum
    ? bytes
    : null;
}

/** A report's PDF: a store's on its own pad, the others on the company's letterhead. */
export async function reportPdf(ctx: CompanyContext, r: Report) {
  const model = reportDocument(ctx, r);
  return r.store
    ? renderDocumentPdf(model, { logo: await storeLogo(r.store.id) })
    : renderOnDemand(ctx, model);
}

/** A download from a Business page: the PDF or the Excel file, logged. */
export async function businessReportFile(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const q = requestSchema.parse(raw);
  const parts = q.format === "pdf" ? q.parts.filter((x) => x !== "days") : q.parts;
  if (parts.length === 0) throw new AppError("VALIDATION", "Every day's rows come only in Excel.");
  const report = await buildReport(ctx, q.scope, q.storeId, q, parts);
  const bytes = q.format === "pdf" ? await reportPdf(ctx, report) : reportWorkbook(ctx, report);
  const label = `${report.store?.name ?? report.title} ${report.from} to ${report.to}`;
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: report.store ? "RetailStore" : "Company",
    entityId: report.store?.id ?? ctx.company.id,
    summary: `Downloaded the ${report.title.toLowerCase()} (${q.format === "pdf" ? "PDF" : "Excel"}) for ${formatDay(report.from)} to ${formatDay(report.to)}: ${parts.join(", ")}`,
  });
  return {
    fileName: documentFileName(ctx.company.name, label, q.format === "pdf" ? ".pdf" : ".xlsx"),
    mimeType: q.format === "pdf" ? "application/pdf" : XLSX_MIME,
    bytes,
  };
}

export { buildReport as buildBusinessReport };
