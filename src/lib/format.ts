import { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { formatDay, groupAmount } from "@/lib/display";

/*
 * Formatting for people: amounts and dates as they appear on PDFs (reports and
 * printed documents). Excel and the JSON APIs keep real numbers and ISO dates.
 * The string-only helpers live in display.ts, which the screens share.
 */

export { formatDay, formatMonth } from "@/lib/display";

/** The calendar day an instant falls on in company time, written out: "2 Oct 2026". */
export function formatInstantDay(at: Date, timeZone: string): string {
  return formatDay(localDay(at, timeZone));
}

/** Exact grouping of a decimal amount: "-12,34,567.50" (BDT) or "-1,234,567.50". */
export function formatAmount(value: Prisma.Decimal.Value, decimals: number, currency: string) {
  return groupAmount(new Prisma.Decimal(value).toFixed(decimals), currency);
}
