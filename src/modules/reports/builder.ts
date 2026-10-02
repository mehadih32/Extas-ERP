import { Prisma, type SalesChannel } from "@prisma/client";

import { localDay, localTime, nextDay, startOfDayInZone } from "@/lib/dates";
import { accountTotals, type Totals, ZERO } from "@/modules/accounts/balances";
import { CASH_SUBTYPES } from "@/modules/accounts/chart";
import { CONTROL_ACCOUNTS } from "@/modules/accounts/control-accounts";
import {
  addDays,
  daysBetweenInclusive,
  monthsBetween,
  type PeriodPreset,
  type ResolvedPeriod,
} from "@/modules/accounts/periods";
import {
  type AccountInfo,
  loadAccounts,
  natural,
  profitFigures,
} from "@/modules/accounts/reports.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials, canSeeSalesAmounts, canSeeStock } from "@/modules/dashboard/access";
import { RECENT_DAYS, stockWindow } from "@/modules/dashboard/insights.service";
import {
  salesByBucket,
  salesByChannel,
  salesTotals,
  type TopSeller,
  topSellers,
} from "@/modules/dashboard/sales-figures";
import {
  deadAndSlowStock,
  highestStock,
  lowStock,
  type SkuStock,
} from "@/modules/dashboard/stock-figures";
import { METRIC_INFO, type ReportMetricKey } from "@/modules/reports/catalog";
import {
  formatAmount,
  formatDay,
  formatRange,
  type ReportColumn,
  type ReportDocument,
  type ReportFigure,
  type ReportRow,
  type ReportSection,
  type ReportTable,
} from "@/modules/reports/document";

/*
 * Builds a report's content for a period from the same figures as the
 * dashboard: the books for money (P&L, positions), the sales documents for
 * invoices, pieces and products, and today's stock for the alerts.
 */

export type ReportOptions = {
  topLimit: number;
  alertLimit: number;
  slowDays: number;
  coverDays: number;
};

export type ReportRequest = {
  title: string;
  period: ResolvedPeriod;
  metrics: ReportMetricKey[];
  options: ReportOptions;
};

export const PERIOD_LABELS: Record<PeriodPreset | "CUSTOM", string> = {
  TODAY: "Today",
  THIS_MONTH: "This month",
  LAST_MONTH: "Last month",
  THIS_FINANCIAL_YEAR: "This financial year",
  LAST_FINANCIAL_YEAR: "Last financial year",
  ONE_WEEK: "Past week",
  ONE_MONTH: "Past month",
  ONE_YEAR: "Past year",
  CUSTOM: "Chosen dates",
};

const CHANNEL_LABELS: Record<SalesChannel, string> = {
  POS: "Shop (POS)",
  WEBSITE: "Website",
  SOCIAL_COMMERCE: "Social commerce",
  WHOLESALE: "Wholesale",
  B2B_PREORDER: "B2B pre-order",
};

/** Periods up to this many days get a row per day; longer ones a row per month. */
const DAILY_UP_TO = 62;

const amount = (d: Prisma.Decimal) => d.toFixed(2);
const percentOf = (part: Prisma.Decimal, whole: Prisma.Decimal) =>
  whole.isZero() ? null : part.dividedBy(whole).times(100).toFixed(1);
const ratio = (part: number, whole: number) =>
  whole === 0 ? null : ((part / whole) * 100).toFixed(1);

type Ledger = {
  accounts: AccountInfo[];
  /** Entries dated in the period. */
  period: Map<string, Totals>;
  /** Everything up to the end of `positionDay`. */
  position: Map<string, Totals>;
};

type Build = {
  ctx: CompanyContext;
  companyId: string;
  tz: string;
  currency: string;
  period: ResolvedPeriod;
  range: { start: Date; end: Date };
  today: string;
  /** The period's last day, or today while the period is still running. */
  positionDay: string;
  options: ReportOptions;
  now: Date;
  ledger: () => Promise<Ledger>;
};

function sumOf(
  accounts: AccountInfo[],
  totals: Map<string, Totals>,
  pick: (a: AccountInfo) => boolean,
) {
  return accounts.filter(pick).reduce((t, a) => t.plus(natural(a, totals)), ZERO);
}

function cur(b: Build, label: string) {
  return `${label} (${b.currency})`;
}

// =============================================================================
// Key figures
// =============================================================================

async function summarySection(b: Build): Promise<ReportSection> {
  const [{ accounts, period, position }, sales] = await Promise.all([
    b.ledger(),
    salesTotals(b.companyId, b.range),
  ]);
  const f = profitFigures(accounts, period);
  const at = (pick: (a: AccountInfo) => boolean) => sumOf(accounts, position, pick);
  const finishedGoods = at((a) => a.subType === "INVENTORY");
  const rawMaterials = at((a) => a.subType === "RAW_MATERIALS");
  const workInProgress = at((a) => a.code === CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code);
  const fixedAssets = at(
    (a) => a.subType === "FIXED_ASSET" || a.subType === "ACCUMULATED_DEPRECIATION",
  );
  const loans = at((a) => a.subType === "LOAN");
  const investors = at((a) => a.subType === "INVESTOR");
  const cash = at((a) => (CASH_SUBTYPES as readonly string[]).includes(a.subType));
  const receivables = at((a) => a.subType === "ACCOUNTS_RECEIVABLE");
  const payables = at((a) => a.subType === "ACCOUNTS_PAYABLE");
  const positionLabel = `Position on ${formatDay(b.positionDay)}`;

  const figures: ReportFigure[] = [
    {
      label: "Stock value",
      value: amount(finishedGoods),
      kind: "money",
      hint: `Finished goods on ${formatDay(b.positionDay)}`,
    },
    {
      label: "Fixed assets",
      value: amount(fixedAssets),
      kind: "money",
      hint: "Book value (cost less depreciation)",
    },
    {
      label: "Loans and investors",
      value: amount(loans.plus(investors)),
      kind: "money",
      hint: `Loans ${formatAmount(loans, 2, b.currency)}, investors ${formatAmount(investors, 2, b.currency)}`,
    },
    {
      label: "Sales",
      value: amount(f.revenue.total),
      kind: "money",
      hint: `${sales.orders} invoices, ${formatAmount(sales.pieces, 0, b.currency)} pieces`,
    },
    {
      label: "Net profit",
      value: amount(f.netProfit),
      kind: "money",
      hint:
        percentOf(f.netProfit, f.revenue.total) === null
          ? "No sales in the period"
          : `${percentOf(f.netProfit, f.revenue.total)}% of sales`,
    },
  ];

  const columns: ReportColumn[] = [
    { label: "Figure", kind: "text", weight: 3 },
    { label: cur(b, "Amount"), kind: "money" },
    { label: "% of sales", kind: "percent", weight: 1 },
  ];
  const line = (label: string, value: Prisma.Decimal, style?: ReportRow["style"]): ReportRow => ({
    cells: [label, amount(value), percentOf(value, f.revenue.total)],
    ...(style ? { style } : {}),
  });
  const periodTable: ReportTable = {
    title: "In this period",
    sheet: "Period figures",
    columns,
    rows: [
      line("Sales (after discounts)", f.revenue.total),
      line("Cost of goods sold", f.costOfSales.total),
      line("Gross profit", f.grossProfit, "subtotal"),
      line("Other income", f.otherIncome.total),
      line("Expenses", f.expenses),
      line("Net profit", f.netProfit, "total"),
    ],
    empty: "",
  };
  const countColumns: ReportColumn[] = [
    { label: "Figure", kind: "text", weight: 3 },
    { label: "Count", kind: "int" },
    { label: cur(b, "Amount"), kind: "money" },
  ];
  const activityTable: ReportTable = {
    title: "Invoices",
    sheet: "Invoices",
    columns: countColumns,
    rows: [
      { cells: ["Invoices issued", sales.orders, amount(sales.net)] },
      { cells: ["Pieces sold", sales.pieces, null] },
      {
        cells: [
          "Average invoice (goods value)",
          null,
          sales.orders === 0 ? null : amount(sales.net.dividedBy(sales.orders)),
        ],
      },
    ],
    empty: "",
  };
  const positionTable: ReportTable = {
    title: positionLabel,
    sheet: "Position",
    columns: [
      { label: "Figure", kind: "text", weight: 3 },
      { label: cur(b, "Amount"), kind: "money" },
    ],
    rows: [
      { cells: ["Cash, bank and mobile wallets", amount(cash)] },
      { cells: ["Finished goods stock", amount(finishedGoods)] },
      { cells: ["Raw materials and accessories", amount(rawMaterials)] },
      { cells: ["Work in progress (production)", amount(workInProgress)] },
      { cells: ["Fixed assets (book value)", amount(fixedAssets)] },
      { cells: ["Buyers owe us (receivables)", amount(receivables)] },
      { cells: ["We owe suppliers (payables)", amount(payables)] },
      { cells: ["Loans", amount(loans)] },
      { cells: ["Investors", amount(investors)] },
    ],
    empty: "",
  };
  return {
    key: "SUMMARY",
    title: METRIC_INFO.SUMMARY.label,
    subtitle: `${formatRange(b.period.from, b.period.to)}; position on ${formatDay(b.positionDay)}`,
    figures,
    tables: [periodTable, activityTable, positionTable],
    notes: [
      "Money figures come from the books. Sales are after discounts, without delivery charges or VAT.",
    ],
  };
}

// =============================================================================
// Sales
// =============================================================================

/** Every day (or month) of the period up to the position day, so gaps show as zero. */
function buckets(b: Build, unit: "day" | "month"): string[] {
  const last = b.positionDay < b.period.from ? b.period.from : b.positionDay;
  if (unit === "month") return monthsBetween(b.period.from, last);
  const days: string[] = [];
  for (let d = b.period.from; d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

async function salesSection(b: Build): Promise<ReportSection> {
  const unit = daysBetweenInclusive(b.period.from, b.period.to) <= DAILY_UP_TO ? "day" : "month";
  const [totals, byBucket, byChannel] = await Promise.all([
    salesTotals(b.companyId, b.range),
    salesByBucket(b.companyId, b.range, b.tz, unit),
    salesByChannel(b.companyId, b.range),
  ]);
  const found = new Map(byBucket.map((r) => [r.bucket, r]));
  // Every day (or month) so far, plus any later one with sales (an invoice dated ahead).
  const keys = [...new Set([...buckets(b, unit), ...found.keys()])].sort();
  const trendRows: ReportRow[] = keys.map((key) => {
    const r = found.get(key);
    return { cells: [key, r?.orders ?? 0, r?.pieces ?? 0, amount(r?.net ?? ZERO)] };
  });
  trendRows.push({
    cells: ["Total", totals.orders, totals.pieces, amount(totals.net)],
    style: "total",
  });

  const channelRows: ReportRow[] = byChannel.map((c) => ({
    cells: [
      CHANNEL_LABELS[c.channel],
      c.orders,
      c.pieces,
      amount(c.net),
      percentOf(c.net, totals.net),
    ],
  }));
  if (channelRows.length > 0) {
    channelRows.push({
      cells: [
        "Total",
        totals.orders,
        totals.pieces,
        amount(totals.net),
        totals.net.isZero() ? null : "100.0",
      ],
      style: "total",
    });
  }

  const notes = [
    "Invoiced sales on their invoice date, after discounts, without delivery charges or VAT. Void invoices and cancelled orders are left out.",
  ];
  if (canSeeFinancials(b.ctx)) {
    const { accounts, period } = await b.ledger();
    const books = sumOf(accounts, period, (a) => a.subType === "SALES");
    if (!books.equals(totals.net)) {
      notes.push(
        `The books show ${formatAmount(books, 2, b.currency)} in sales for this period. The difference comes from invoices voided after the period, or earlier invoices voided during it.`,
      );
    }
  }

  return {
    key: "SALES",
    title: METRIC_INFO.SALES.label,
    subtitle: formatRange(b.period.from, b.period.to),
    figures: [
      { label: "Net sales", value: amount(totals.net), kind: "money" },
      { label: "Invoices", value: totals.orders, kind: "int" },
      { label: "Pieces sold", value: totals.pieces, kind: "int" },
      {
        label: "Average invoice",
        value: totals.orders === 0 ? null : amount(totals.net.dividedBy(totals.orders)),
        kind: "money",
      },
    ],
    tables: [
      {
        title: unit === "day" ? "Sales by day" : "Sales by month",
        sheet: unit === "day" ? "Sales by day" : "Sales by month",
        columns: [
          { label: unit === "day" ? "Day" : "Month", kind: unit, weight: 2 },
          { label: "Invoices", kind: "int" },
          { label: "Pieces", kind: "int" },
          { label: cur(b, "Net sales"), kind: "money", weight: 2 },
        ],
        rows: trendRows,
        empty: "No sales in this period.",
      },
      {
        title: "Sales by channel",
        sheet: "Sales by channel",
        columns: [
          { label: "Channel", kind: "text", weight: 2 },
          { label: "Invoices", kind: "int" },
          { label: "Pieces", kind: "int" },
          { label: cur(b, "Net sales"), kind: "money", weight: 2 },
          { label: "Share", kind: "percent" },
        ],
        rows: channelRows,
        empty: "No sales in this period.",
      },
    ],
    notes,
  };
}

// =============================================================================
// Profit and loss
// =============================================================================

async function profitSection(b: Build): Promise<ReportSection> {
  const { accounts, period } = await b.ledger();
  const f = profitFigures(accounts, period);
  const revenue = f.revenue.total;
  const row = (
    label: string,
    value: Prisma.Decimal | string | null,
    style?: ReportRow["style"],
    indent = false,
  ): ReportRow => {
    const d = value === null ? null : new Prisma.Decimal(value);
    return {
      cells: [label, d ? amount(d) : null, d ? percentOf(d, revenue) : null],
      ...(style ? { style } : {}),
      ...(indent ? { indent } : {}),
    };
  };
  const group = (
    title: string,
    lines: Array<{ name: string; amount: string }>,
    total: Prisma.Decimal,
    totalLabel: string,
  ): ReportRow[] =>
    lines.length === 0
      ? []
      : [
          row(title, null, "heading"),
          ...lines.map((l) => row(l.name, l.amount, undefined, true)),
          row(totalLabel, total, "subtotal"),
        ];

  const rows: ReportRow[] = [
    ...group("Sales", f.revenue.lines, revenue, "Total sales"),
    ...group(
      "Cost of goods sold",
      f.costOfSales.lines,
      f.costOfSales.total,
      "Total cost of goods sold",
    ),
    row("Gross profit", f.grossProfit, "total"),
    ...group("Other income", f.otherIncome.lines, f.otherIncome.total, "Total other income"),
    ...f.expenseGroups.flatMap((g) =>
      group(g.label, g.lines, g.total, `Total ${g.label.toLowerCase()}`),
    ),
    row("Total expenses", f.expenses, "subtotal"),
    row("Net profit", f.netProfit, "total"),
  ];
  return {
    key: "PROFIT_AND_LOSS",
    title: METRIC_INFO.PROFIT_AND_LOSS.label,
    subtitle: formatRange(b.period.from, b.period.to),
    figures: [
      { label: "Sales", value: amount(revenue), kind: "money" },
      {
        label: "Gross profit",
        value: amount(f.grossProfit),
        kind: "money",
        hint: margin(f.grossProfit, revenue),
      },
      { label: "Expenses", value: amount(f.expenses), kind: "money" },
      {
        label: "Net profit",
        value: amount(f.netProfit),
        kind: "money",
        hint: margin(f.netProfit, revenue),
      },
    ],
    tables: [
      {
        title: "Profit and loss",
        sheet: "Profit and loss",
        columns: [
          { label: "Account", kind: "text", weight: 4 },
          { label: cur(b, "Amount"), kind: "money", weight: 1.6 },
          { label: "% of sales", kind: "percent", weight: 1.1 },
        ],
        rows,
        empty: "",
      },
    ],
    notes: [
      "From the books: entries dated in the period, with reversed entries cancelling out. Production costs reach cost of goods sold when the goods are sold.",
    ],
  };
}

function margin(part: Prisma.Decimal, revenue: Prisma.Decimal) {
  const p = percentOf(part, revenue);
  return p === null ? undefined : `${p}% of sales`;
}

// =============================================================================
// Top sellers
// =============================================================================

async function topSellersSection(b: Build): Promise<ReportSection> {
  const sales = canSeeSalesAmounts(b.ctx);
  const costs = canSeeFinancials(b.ctx);
  const stock = canSeeStock(b.ctx);
  const limit = b.options.topLimit;
  const [bySku, byStyle] = await Promise.all([
    topSellers(b.companyId, b.range, { groupBy: "SKU", sortBy: "QUANTITY", limit }),
    topSellers(b.companyId, b.range, {
      groupBy: "STYLE",
      sortBy: "QUANTITY",
      limit: Math.min(limit, 20),
    }),
  ]);
  const totals = bySku.totals;

  const moneyColumns = (r: TopSeller): Array<string | null> => [
    ...(sales ? [amount(r.net), r.pieces > 0 ? amount(r.net.dividedBy(r.pieces)) : null] : []),
    ...(costs ? [percentOf(r.net.minus(r.cost), r.net)] : []),
  ];
  const moneyHeads: ReportColumn[] = [
    ...(sales
      ? [
          { label: cur(b, "Net sales"), kind: "money" as const, weight: 1.5 },
          { label: "Avg price", kind: "money" as const, weight: 1.2 },
        ]
      : []),
    ...(costs ? [{ label: "Margin", kind: "percent" as const, weight: 1 }] : []),
  ];
  const stockHead: ReportColumn[] = stock ? [{ label: "In stock", kind: "int", weight: 0.9 }] : [];
  const stockCell = (r: TopSeller) => (stock ? [r.available] : []);

  const skuTable: ReportTable = {
    title: `Top ${limit} SKUs by pieces sold`,
    sheet: "Top SKUs",
    columns: [
      { label: "#", kind: "int", weight: 0.5 },
      { label: "SKU", kind: "text", weight: 2.4 },
      { label: "Product", kind: "text", weight: 2.2 },
      { label: "Color", kind: "text", weight: 1.1 },
      { label: "Size", kind: "text", weight: 0.7 },
      { label: "Pieces", kind: "int", weight: 0.9 },
      { label: "Share", kind: "percent", weight: 0.9 },
      ...moneyHeads,
      ...stockHead,
    ],
    rows: bySku.items.map((r, i) => ({
      cells: [
        i + 1,
        r.sku,
        r.styleName,
        r.colorName,
        r.sizeName,
        r.pieces,
        ratio(r.pieces, totals.pieces),
        ...moneyColumns(r),
        ...stockCell(r),
      ],
    })),
    empty: "Nothing was sold in this period.",
  };
  const styleTable: ReportTable = {
    title: `Top ${Math.min(limit, 20)} styles by pieces sold`,
    sheet: "Top styles",
    columns: [
      { label: "#", kind: "int", weight: 0.5 },
      { label: "Style", kind: "text", weight: 1.6 },
      { label: "Product", kind: "text", weight: 2.6 },
      { label: "SKUs sold", kind: "int", weight: 0.9 },
      { label: "Pieces", kind: "int", weight: 0.9 },
      { label: "Share", kind: "percent", weight: 0.9 },
      ...moneyHeads,
      ...stockHead,
    ],
    rows: byStyle.items.map((r, i) => ({
      cells: [
        i + 1,
        r.styleCode,
        r.styleName,
        r.skus,
        r.pieces,
        ratio(r.pieces, totals.pieces),
        ...moneyColumns(r),
        ...stockCell(r),
      ],
    })),
    empty: "Nothing was sold in this period.",
  };

  const figures: ReportFigure[] = [
    { label: "SKUs sold", value: totals.groups, kind: "int" },
    { label: "Pieces sold", value: totals.pieces, kind: "int" },
    ...(sales ? [{ label: "Net sales", value: amount(totals.net), kind: "money" as const }] : []),
    ...(costs
      ? [
          {
            label: "Gross margin",
            value: percentOf(totals.net.minus(totals.cost), totals.net),
            kind: "percent" as const,
            hint: "Estimated from the goods' costs",
          },
        ]
      : []),
  ];
  const notes = [
    `Pieces on invoices dated in the period (void invoices left out). Order discounts are shared across each order's lines by value.${stock ? ' "In stock" is sellable stock now.' : ""}`,
  ];
  if (costs) {
    notes.push(
      "Margin uses the cost recorded when the goods were delivered, or today's average cost for goods not delivered yet.",
    );
  }
  return {
    key: "TOP_SELLERS",
    title: METRIC_INFO.TOP_SELLERS.label,
    subtitle: formatRange(b.period.from, b.period.to),
    figures,
    tables: [skuTable, styleTable],
    notes,
  };
}

// =============================================================================
// Stock alerts
// =============================================================================

async function stockAlertsSection(b: Build): Promise<ReportSection> {
  const costs = canSeeFinancials(b.ctx);
  const window = stockWindow(b.ctx.company, b.options, b.now);
  const threshold = b.ctx.company.lowStockThreshold;
  const limit = b.options.alertLimit;
  const [low, deadSlow, highest] = await Promise.all([
    lowStock(b.companyId, window, threshold, limit),
    deadAndSlowStock(b.companyId, window, limit),
    highestStock(b.companyId, window, Math.min(limit, 20)),
  ]);
  const sku = (r: SkuStock) => [r.sku, r.styleName, r.colorName, r.sizeName];
  const skuHeads: ReportColumn[] = [
    { label: "SKU", kind: "text", weight: 2.4 },
    { label: "Product", kind: "text", weight: 2.2 },
    { label: "Color", kind: "text", weight: 1.1 },
    { label: "Size", kind: "text", weight: 0.7 },
  ];
  const valueHead: ReportColumn[] = costs
    ? [{ label: cur(b, "Value"), kind: "money", weight: 1.4 }]
    : [];
  const lastSold = (r: SkuStock) => (r.lastSoldAt ? localDay(r.lastSoldAt, b.tz) : null);

  const figures: ReportFigure[] = [
    {
      label: "Low stock SKUs",
      value: low.total,
      kind: "int",
      hint: `Below ${threshold} pieces; ${low.outOfStock} out of stock`,
    },
    {
      label: "Dead stock",
      value: costs ? amount(deadSlow.dead.value) : deadSlow.dead.pieces,
      kind: costs ? "money" : "int",
      hint: `${deadSlow.dead.skus} SKUs, ${formatAmount(deadSlow.dead.pieces, 0, b.currency)} pieces with no sale in ${window.slowDays} days`,
    },
    {
      label: "Slow stock",
      value: costs ? amount(deadSlow.slow.value) : deadSlow.slow.pieces,
      kind: costs ? "money" : "int",
      hint: `${deadSlow.slow.skus} SKUs, ${formatAmount(deadSlow.slow.pieces, 0, b.currency)} pieces lasting over ${window.coverDays} days`,
    },
  ];

  return {
    key: "STOCK_ALERTS",
    title: METRIC_INFO.STOCK_ALERTS.label,
    subtitle: `Stock on ${formatDay(b.today)} (alerts always show the stock of the day the report is made)`,
    figures,
    tables: [
      {
        title: `Low stock: below ${threshold} pieces available`,
        sheet: "Low stock",
        columns: [
          ...skuHeads,
          { label: "On hand", kind: "int", weight: 0.9 },
          { label: "Reserved", kind: "int", weight: 0.9 },
          { label: "Available", kind: "int", weight: 0.9 },
          { label: `Sold (${RECENT_DAYS} days)`, kind: "int", weight: 1.1 },
        ],
        rows: low.items.map((r) => ({
          cells: [...sku(r), r.onHand, r.reserved, r.available, r.soldRecently],
        })),
        empty: "No SKU is low on stock.",
      },
      {
        title: `Dead and slow stock (${window.slowDays}-day window)`,
        sheet: "Dead and slow stock",
        columns: [
          ...skuHeads,
          { label: "Status", kind: "text", weight: 0.8 },
          { label: "Available", kind: "int", weight: 0.9 },
          { label: `Sold (${window.slowDays} days)`, kind: "int", weight: 1.1 },
          { label: "Last sold", kind: "day", weight: 1.3 },
          { label: "Days of cover", kind: "int", weight: 1 },
          ...valueHead,
        ],
        rows: deadSlow.items.map((r) => ({
          cells: [
            ...sku(r),
            r.movement === "DEAD" ? "Dead" : "Slow",
            r.available,
            r.soldInWindow,
            lastSold(r),
            r.daysOfCover,
            ...(costs ? [amount(r.availableValue)] : []),
          ],
        })),
        empty: "No dead or slow stock.",
      },
      {
        title: `Highest stock: top ${Math.min(limit, 20)} SKUs by pieces on hand`,
        sheet: "Highest stock",
        columns: [
          ...skuHeads,
          { label: "On hand", kind: "int", weight: 0.9 },
          { label: "A grade", kind: "int", weight: 0.9 },
          { label: "B grade", kind: "int", weight: 0.9 },
          { label: "Available", kind: "int", weight: 0.9 },
          ...valueHead,
        ],
        rows: highest.map((r) => ({
          cells: [
            ...sku(r),
            r.onHand,
            r.aGrade,
            r.bGrade,
            r.available,
            ...(costs ? [amount(r.availableValue)] : []),
          ],
        })),
        empty: "No stock on hand.",
      },
    ],
    notes: [
      `Dead: had stock ${window.slowDays} days ago and sold nothing since. Slow: sells, but at that pace the available pieces last over ${window.coverDays} days. SKUs stocked within the window are not judged yet.`,
      ...(costs ? ["Values are available pieces at average cost."] : []),
    ],
  };
}

// =============================================================================
// The report
// =============================================================================

const SECTIONS: Record<ReportMetricKey, (b: Build) => Promise<ReportSection>> = {
  SUMMARY: summarySection,
  SALES: salesSection,
  PROFIT_AND_LOSS: profitSection,
  TOP_SELLERS: topSellersSection,
  STOCK_ALERTS: stockAlertsSection,
};

/** The report's content. Callers check that the person may see each metric. */
export async function buildReport(
  ctx: CompanyContext,
  request: ReportRequest,
  now: Date = new Date(),
): Promise<ReportDocument> {
  const company = ctx.company;
  const tz = company.timezone;
  const today = localDay(now, tz);
  const { period } = request;
  const positionDay = period.to < today ? period.to : today;
  let ledger: Promise<Ledger> | undefined;
  const b: Build = {
    ctx,
    companyId: company.id,
    tz,
    currency: company.currency,
    period,
    range: { start: period.start, end: period.end },
    today,
    positionDay,
    options: request.options,
    now,
    ledger: () =>
      (ledger ??= (async () => {
        const accounts = await loadAccounts(company.id);
        const [inPeriod, position] = await Promise.all([
          accountTotals(company.id, { start: period.start, end: period.end }),
          accountTotals(company.id, { end: startOfDayInZone(nextDay(positionDay), tz) }),
        ]);
        return { accounts, period: inPeriod, position };
      })()),
  };

  const sections: ReportSection[] = [];
  for (const key of request.metrics) sections.push(await SECTIONS[key](b));

  return {
    title: request.title,
    company: {
      name: company.name,
      legalName: company.legalName,
      address: company.address,
      phone: company.phone,
      email: company.email,
      website: company.website,
      primaryColor: company.primaryColor,
      accentColor: company.accentColor,
      currency: company.currency,
    },
    period: {
      period: period.period,
      from: period.from,
      to: period.to,
      label: `${PERIOD_LABELS[period.period]}: ${formatRange(period.from, period.to)}`,
    },
    generatedAt: now.toISOString(),
    generatedOn: `${formatDay(today)}, ${localTime(now, tz)}`,
    generatedBy: ctx.user.name,
    timezone: tz,
    sections,
  };
}
