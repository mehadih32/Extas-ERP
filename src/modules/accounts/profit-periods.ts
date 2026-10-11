import { Prisma } from "@prisma/client";

import { addDays, addMonths, financialYearStart, monthStart } from "@/modules/accounts/periods";

/*
 * The periods the Net profit card covers and how it compares them: plain
 * functions of today's date, so the browser, the services and the tests agree.
 */

export const PROFIT_PERIODS = ["TODAY", "MONTH", "YEAR", "LIFETIME"] as const;
export type ProfitPeriod = (typeof PROFIT_PERIODS)[number];

export function isProfitPeriod(value: unknown): value is ProfitPeriod {
  return typeof value === "string" && (PROFIT_PERIODS as readonly string[]).includes(value);
}

export type ProfitWindow = {
  /** First day counted, or null from the very first entry. */
  from: string | null;
  /** Today (in company time). */
  to: string;
  /** The same days of the period before, to compare with (none for all time). */
  previous: { from: string; to: string } | null;
};

/**
 * The days a period covers up to today, and the same span of the period before:
 * this month so far against the same days of last month, this financial year so
 * far against the same days of the last one, today against yesterday.
 */
export function profitWindow(
  period: ProfitPeriod,
  today: string,
  fiscalYearStartMonth: number,
): ProfitWindow {
  switch (period) {
    case "TODAY": {
      const yesterday = addDays(today, -1);
      return { from: today, to: today, previous: { from: yesterday, to: yesterday } };
    }
    case "MONTH": {
      const from = monthStart(today);
      return { from, to: today, previous: { from: addMonths(from, -1), to: addMonths(today, -1) } };
    }
    case "YEAR": {
      const from = financialYearStart(today, fiscalYearStartMonth);
      return {
        from,
        to: today,
        previous: { from: addMonths(from, -12), to: addMonths(today, -12) },
      };
    }
    case "LIFETIME":
      return { from: null, to: today, previous: null };
  }
}

export type Growth = {
  direction: "UP" | "DOWN" | "FLAT";
  /** How much it moved against the period before, "12.5"; null when that was zero. */
  percent: string | null;
};

/** Up or down against the period before, as a share of the earlier figure (a loss too). */
export function growth(current: Prisma.Decimal, previous: Prisma.Decimal): Growth {
  const change = current.minus(previous);
  const direction = change.gt(0) ? "UP" : change.lt(0) ? "DOWN" : "FLAT";
  if (previous.isZero()) return { direction, percent: null };
  const percent = change
    .abs()
    .dividedBy(previous.abs())
    .times(100)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP);
  return { direction, percent: percent.toFixed(1) };
}
