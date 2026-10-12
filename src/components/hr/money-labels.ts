import { formatDay, formatDayRange } from "@/lib/display";
import type { MoneyKind, MoneyPeriod, MoneyRange } from "@/modules/hr/money.service";

/** Words for HR > Money, shared by the page (server) and its board (client). */
export const MONEY_RANGE_LABELS: Record<MoneyRange, string> = {
  week: "Last week",
  month: "1 month",
  "6m": "6 months",
  year: "1 year",
  all: "Lifetime",
  custom: "Custom",
};

export const MONEY_KIND_LABELS: Record<MoneyKind, string> = {
  salary: "Total salary",
  conveyance: "Total conveyance",
  bonus: "Total bonus",
  overtime: "Total overtime",
};

/** "13 Sep – 12 Oct 2026", or "Everything up to 12 Oct 2026" for lifetime. */
export function periodText(period: MoneyPeriod): string {
  return period.from
    ? formatDayRange(period.from, period.to)
    : `Everything up to ${formatDay(period.to)}`;
}

/** "14.5 hours" from "14.50". */
export function hoursText(fixed: string): string {
  const n = Number(fixed);
  return `${n} ${n === 1 ? "hour" : "hours"}`;
}
