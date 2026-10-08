import { PERIOD_OPTIONS } from "@/components/dashboard/top-sellers-view";
import { type PeriodPreset, presetRange } from "@/modules/accounts/periods";

/*
 * The Bad stock tab's period, kept in the address bar like the dashboard's:
 * "/products/bad-stock?period=this-month". "All time" is the default and stays
 * out of the address.
 */

export type BadStockPeriod = PeriodPreset | "ALL";

export const BAD_STOCK_PERIODS: ReadonlyArray<{ value: BadStockPeriod; label: string }> = [
  { value: "ALL", label: "All time" },
  ...PERIOD_OPTIONS,
];

/** Entries shown at first and per "Show more". */
export const BAD_STOCK_PAGE_SIZE = 30;

const slug = (period: BadStockPeriod) => period.toLowerCase().replaceAll("_", "-");

export function badStockPeriodFrom(params: Record<string, string | string[] | undefined>) {
  const value = params.period;
  return (
    BAD_STOCK_PERIODS.find((p) => p.value !== "ALL" && slug(p.value) === value)?.value ?? "ALL"
  );
}

export function badStockSearch(period: BadStockPeriod): string {
  return period === "ALL" ? "" : `?period=${slug(period)}`;
}

/** The days the period covers in company time, or none for all time. */
export function badStockDays(
  period: BadStockPeriod,
  today: string,
  fiscalYearStartMonth: number,
): { from?: string; to?: string } {
  return period === "ALL" ? {} : presetRange(period, today, fiscalYearStartMonth);
}
