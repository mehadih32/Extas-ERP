import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials, canSeeSalesAmounts, canSeeStock } from "@/modules/dashboard/access";

/*
 * The metrics a person can pick in the Report Builder. Each needs its own
 * permission on top of reports.export, so a report never shows what its reader
 * could not open in the app. Some metrics also show extra columns when their
 * maker may see them (sales values, margins, stock); a saved report remembers
 * which, and opens only for people who may see those too.
 */

export const REPORT_METRICS = [
  "SUMMARY",
  "SALES",
  "PROFIT_AND_LOSS",
  "TOP_SELLERS",
  "STOCK_ALERTS",
] as const;

export type ReportMetricKey = (typeof REPORT_METRICS)[number];

type Can = Pick<CompanyContext, "can">;

/** Extra figures a report shows beyond its metrics, decided by its maker's permissions. */
export type ReportShows = { salesAmounts: boolean; financials: boolean; stock: boolean };

const SHOWS: Record<keyof ReportShows, (ctx: Can) => boolean> = {
  salesAmounts: canSeeSalesAmounts,
  financials: canSeeFinancials,
  stock: canSeeStock,
};

export const SHOWS_KEYS = Object.keys(SHOWS) as Array<keyof ReportShows>;

export const METRIC_INFO: Record<
  ReportMetricKey,
  {
    label: string;
    description: string;
    allowed: (ctx: Can) => boolean;
    needs: string;
    /** Extras the section adds when its maker may see them. */
    extras: Array<keyof ReportShows>;
  }
> = {
  SUMMARY: {
    label: "Key figures",
    description:
      "The owner's cards for the period: sales, profit and margins, plus stock value, fixed assets, loans and investors at its end.",
    allowed: canSeeFinancials,
    needs: "dashboard.financials or accounts.view",
    extras: [],
  },
  SALES: {
    label: "Sales",
    description: "Invoiced sales day by day (month by month for long periods) and by channel.",
    allowed: canSeeSalesAmounts,
    needs: "sales.view",
    // A note comparing the sales with the books.
    extras: ["financials"],
  },
  PROFIT_AND_LOSS: {
    label: "Profit and loss",
    description:
      "Sales, cost of goods sold, expenses and net profit for the period, from the books.",
    allowed: canSeeFinancials,
    needs: "dashboard.financials or accounts.view",
    extras: [],
  },
  TOP_SELLERS: {
    label: "Top sellers",
    description:
      "Best-selling SKUs and styles in the period (sales values with sales.view, margins with the financials).",
    allowed: (ctx) => canSeeStock(ctx) || canSeeSalesAmounts(ctx),
    needs: "dashboard.view, inventory.view or sales.view",
    // Sales values, margins and the stock left.
    extras: ["salesAmounts", "financials", "stock"],
  },
  STOCK_ALERTS: {
    label: "Stock alerts",
    description:
      "Low stock, dead and slow stock, and the SKUs holding the most stock, as of the day the report is made.",
    allowed: canSeeStock,
    needs: "dashboard.view or inventory.view",
    // Stock values.
    extras: ["financials"],
  },
};

/** Every metric with whether this person may pick it (the Report Builder's list). */
export function listReportMetrics(ctx: Can) {
  return REPORT_METRICS.map((key) => ({
    key,
    label: METRIC_INFO[key].label,
    description: METRIC_INFO[key].description,
    available: METRIC_INFO[key].allowed(ctx),
  }));
}

/** The metrics this person may see, in catalogue order. */
export function allowedMetrics(ctx: Can): ReportMetricKey[] {
  return REPORT_METRICS.filter((key) => METRIC_INFO[key].allowed(ctx));
}

/** What a report with these metrics shows beyond them when this person makes it. */
export function reportShows(ctx: Can, metrics: readonly ReportMetricKey[]): ReportShows {
  const used = new Set(metrics.flatMap((key) => METRIC_INFO[key].extras));
  return {
    salesAmounts: used.has("salesAmounts") && SHOWS.salesAmounts(ctx),
    financials: used.has("financials") && SHOWS.financials(ctx),
    stock: used.has("stock") && SHOWS.stock(ctx),
  };
}

function isMetric(key: string): key is ReportMetricKey {
  return (REPORT_METRICS as readonly string[]).includes(key);
}

/**
 * Whether this person may open a saved report: they may pick every metric in it
 * and see every extra it shows. A report that does not say what it shows is
 * treated as showing everything.
 */
export function mayOpenReport(
  ctx: Can,
  report: { metrics: readonly string[]; shows: ReportShows | null },
): boolean {
  const metricsOk = report.metrics.every((key) => isMetric(key) && METRIC_INFO[key].allowed(ctx));
  return (
    metricsOk && SHOWS_KEYS.every((extra) => !(report.shows?.[extra] ?? true) || SHOWS[extra](ctx))
  );
}

/** The extras this person may not see (to leave out other people's reports that show them). */
export function hiddenExtras(ctx: Can): Array<keyof ReportShows> {
  return SHOWS_KEYS.filter((extra) => !SHOWS[extra](ctx));
}
