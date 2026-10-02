import { daysBetween, localDay, nextDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";

/*
 * Report periods as calendar days in company time. Presets follow the Report
 * Builder (1 week, 1 month, 1 year) plus the usual calendar and financial-year
 * periods. The financial year starts in the company's `fiscalYearStartMonth`
 * (July by default: the Bangladesh income year runs July to June).
 */

export const PERIOD_PRESETS = [
  "TODAY",
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_FINANCIAL_YEAR",
  "LAST_FINANCIAL_YEAR",
  "ONE_WEEK",
  "ONE_MONTH",
  "ONE_YEAR",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export type ResolvedPeriod = {
  period: PeriodPreset | "CUSTOM";
  /** First and last calendar day, inclusive ("2026-07-01"). */
  from: string;
  to: string;
  /** The same period as instants: [start, end). */
  start: Date;
  end: Date;
};

const pad = (n: number) => String(n).padStart(2, "0");

function parts(day: string) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

/** Days in a month (month 1-12). */
function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds whole months, keeping the day where the month allows (31 Mar - 1 month = 28/29 Feb). */
export function addMonths(day: string, months: number): string {
  const { y, m, d } = parts(day);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function monthEnd(day: string): string {
  const { y, m } = parts(day);
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}

/** First day of the financial year that contains `day`. */
export function financialYearStart(day: string, startMonth: number): string {
  const { y, m } = parts(day);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${pad(startMonth)}-01`;
}

/** Calendar days in [from, to], counting both ends. */
export function daysBetweenInclusive(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

/** Calendar months touched by [from, to], as "YYYY-MM". */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let day = monthStart(from); day <= to; day = addMonths(day, 1)) {
    months.push(day.slice(0, 7));
  }
  return months;
}

export function presetRange(
  preset: PeriodPreset,
  today: string,
  fiscalYearStartMonth: number,
): { from: string; to: string } {
  switch (preset) {
    case "TODAY":
      return { from: today, to: today };
    case "THIS_MONTH":
      return { from: monthStart(today), to: monthEnd(today) };
    case "LAST_MONTH": {
      const start = addMonths(monthStart(today), -1);
      return { from: start, to: monthEnd(start) };
    }
    case "THIS_FINANCIAL_YEAR": {
      const start = financialYearStart(today, fiscalYearStartMonth);
      return { from: start, to: addDays(addMonths(start, 12), -1) };
    }
    case "LAST_FINANCIAL_YEAR": {
      const start = addMonths(financialYearStart(today, fiscalYearStartMonth), -12);
      return { from: start, to: addDays(addMonths(start, 12), -1) };
    }
    case "ONE_WEEK":
      return { from: addDays(today, -6), to: today };
    case "ONE_MONTH":
      return { from: addDays(addMonths(today, -1), 1), to: today };
    case "ONE_YEAR":
      return { from: addDays(addMonths(today, -12), 1), to: today };
  }
}

/**
 * The period a report covers: explicit `from` / `to` days win, otherwise the
 * preset (this month by default).
 */
export function resolvePeriod(
  input: { period?: PeriodPreset; from?: string; to?: string },
  company: { timezone: string; fiscalYearStartMonth: number },
  now: Date = new Date(),
): ResolvedPeriod {
  const today = localDay(now, company.timezone);
  let period: ResolvedPeriod["period"];
  let from: string;
  let to: string;
  if (input.from || input.to) {
    period = "CUSTOM";
    from = input.from ?? input.to!;
    to = input.to ?? today;
  } else {
    period = input.period ?? "THIS_MONTH";
    ({ from, to } = presetRange(period, today, company.fiscalYearStartMonth));
  }
  if (from > to) throw new AppError("VALIDATION", "'From' date is after 'to' date.");
  if (monthsBetween(from, to).length > 120) {
    throw new AppError("VALIDATION", "Reports can cover up to 10 years.");
  }
  return {
    period,
    from,
    to,
    start: startOfDayInZone(from, company.timezone),
    end: startOfDayInZone(nextDay(to), company.timezone),
  };
}
