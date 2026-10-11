/*
 * The month or year the expense breakdown on the Accounts Overview covers,
 * kept in the address bar as "?costs=2026-10" (one month) or "?costs=2026"
 * (the whole calendar year). Salaries count by the month they are for, every
 * other figure by its date. Pure functions, shared by the server and the page.
 */

export type CostPeriod = {
  year: number;
  /** 1-12; null for the whole year. */
  month: number | null;
};

const PARAM = /^(\d{4})(?:-(\d{2}))?$/;

/** "2026-10" or "2026" from the address bar; null when it is neither. */
export function parseCostPeriod(raw: unknown): CostPeriod | null {
  if (typeof raw !== "string") return null;
  const match = PARAM.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  if (year < 2000 || year > 2100) return null;
  if (month !== null && (month < 1 || month > 12)) return null;
  return { year, month };
}

/** The address-bar value: "2026-10", or "2026" for the whole year. */
export function costPeriodParam(period: CostPeriod): string {
  return period.month === null
    ? String(period.year)
    : `${period.year}-${String(period.month).padStart(2, "0")}`;
}

/** The days covered, first to last ("2026-10-01" to "2026-10-31"). */
export function costWindow(period: CostPeriod): { from: string; to: string } {
  const y = String(period.year);
  if (period.month === null) return { from: `${y}-01-01`, to: `${y}-12-31` };
  const m = String(period.month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(lastDay).padStart(2, "0")}` };
}

/** The month a day falls in, as the breakdown names it: today's, by default. */
export function costPeriodOf(day: string): CostPeriod {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
}

/** The years to choose from, newest first: from the first year with entries to this one. */
export function costYears(firstYear: number | null, thisYear: number): number[] {
  const first = Math.min(firstYear ?? thisYear, thisYear);
  return Array.from({ length: thisYear - first + 1 }, (_, i) => thisYear - i);
}
