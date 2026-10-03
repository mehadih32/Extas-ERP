import type { PeriodPreset } from "@/modules/accounts/periods";

/*
 * The top sellers' choices (period, SKUs or styles, by pieces or sales value),
 * kept in the address bar so a refresh or a shared link shows the same list:
 * "/?period=this-month&group=style&sort=sales". Defaults stay out of the address.
 */

export const PERIOD_OPTIONS: ReadonlyArray<{ value: PeriodPreset; label: string }> = [
  { value: "TODAY", label: "Today" },
  { value: "ONE_WEEK", label: "Past 7 days" },
  { value: "ONE_MONTH", label: "Past month" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "ONE_YEAR", label: "Past year" },
  { value: "THIS_FINANCIAL_YEAR", label: "This financial year" },
  { value: "LAST_FINANCIAL_YEAR", label: "Last financial year" },
];

/** The dashboard API's own default (the month up to today). */
export const DEFAULT_PERIOD: PeriodPreset = "ONE_MONTH";

export type TopSellersView = {
  period: PeriodPreset;
  groupBy: "SKU" | "STYLE";
  sortBy: "QUANTITY" | "REVENUE";
};

type SearchParams = Record<string, string | string[] | undefined>;

const slug = (period: PeriodPreset) => period.toLowerCase().replaceAll("_", "-");

/**
 * Reads the choices from the address bar. Anything unknown falls back to the
 * default, and so does sorting by sales value for people who may not see sales.
 */
export function topSellersViewFrom(
  params: SearchParams,
  options: { canSortBySales: boolean },
): TopSellersView {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };
  const period = PERIOD_OPTIONS.find((o) => slug(o.value) === one("period"))?.value;
  return {
    period: period ?? DEFAULT_PERIOD,
    groupBy: one("group") === "style" ? "STYLE" : "SKU",
    sortBy: options.canSortBySales && one("sort") === "sales" ? "REVENUE" : "QUANTITY",
  };
}

/** The address-bar query for a choice: "?period=this-month&group=style", or "" for the defaults. */
export function topSellersSearch(view: TopSellersView): string {
  const params = new URLSearchParams();
  if (view.period !== DEFAULT_PERIOD) params.set("period", slug(view.period));
  if (view.groupBy === "STYLE") params.set("group", "style");
  if (view.sortBy === "REVENUE") params.set("sort", "sales");
  const query = params.toString();
  return query ? `?${query}` : "";
}
