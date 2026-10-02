import { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";

/*
 * Formatting for people: amounts and dates as they appear on PDFs (reports and
 * printed documents). Excel and the JSON APIs keep real numbers and ISO dates.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Currencies written with lakh / crore grouping (12,34,567.50). */
const LAKH_CURRENCIES = new Set(["BDT", "INR", "NPR", "PKR"]);

/** "1 Sep 2026" for "2026-09-01". */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Sep 2026" for "2026-09". */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/** The calendar day an instant falls on in company time, written out: "2 Oct 2026". */
export function formatInstantDay(at: Date, timeZone: string): string {
  return formatDay(localDay(at, timeZone));
}

function groupDigits(digits: string, lakh: boolean): string {
  if (!lakh || digits.length <= 3) return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${head},${digits.slice(-3)}`;
}

/** Exact grouping of a decimal amount: "-12,34,567.50" (BDT) or "-1,234,567.50". */
export function formatAmount(value: Prisma.Decimal.Value, decimals: number, currency: string) {
  const fixed = new Prisma.Decimal(value).toFixed(decimals);
  const negative = fixed.startsWith("-") && /[1-9]/.test(fixed);
  const [whole, fraction] = fixed.replace("-", "").split(".") as [string, string?];
  const grouped = groupDigits(whole, LAKH_CURRENCIES.has(currency.toUpperCase()));
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}
