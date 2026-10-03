/*
 * Formatting for people, shared by the screens and the PDFs: plain strings in,
 * plain strings out, so it also runs in the browser. Amounts arrive as the
 * fixed-point strings the APIs return ("1234567.50").
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Currencies written with lakh / crore grouping (12,34,567.50). */
const LAKH_CURRENCIES = new Set(["BDT", "INR", "NPR", "PKR"]);

export function usesLakhGrouping(currency: string): boolean {
  return LAKH_CURRENCIES.has(currency.toUpperCase());
}

/** Thousands separators for a run of digits: lakh style (12,34,567) or western (1,234,567). */
export function groupDigits(digits: string, lakh: boolean): string {
  if (!lakh || digits.length <= 3) return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${head},${digits.slice(-3)}`;
}

/** "-12,34,567.50" (BDT) or "-1,234,567.50" from "-1234567.50"; "-0.00" reads "0.00". */
export function groupAmount(fixed: string, currency: string): string {
  const negative = fixed.startsWith("-") && /[1-9]/.test(fixed);
  const [whole, fraction] = fixed.replace("-", "").split(".") as [string, string?];
  const grouped = groupDigits(whole, usesLakhGrouping(currency));
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Whole numbers such as pieces, grouped the way the company's currency is: "1,24,500". */
export function formatCount(value: number, currency: string): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${groupDigits(String(Math.abs(Math.trunc(value))), usesLakhGrouping(currency))}`;
}

/** "1 Sep 2026" for "2026-09-01". */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Saturday, 3 October 2026" for "2026-10-03". */
export function formatLongDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${FULL_MONTHS[m - 1]} ${y}`;
}

/** "Sep 2026" for "2026-09". */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/** "4 Sep – 3 Oct 2026", "1 – 30 Sep 2026", or one day when both ends match. */
export function formatDayRange(from: string, to: string): string {
  if (from === to) return formatDay(from);
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  if (fy !== ty) return `${formatDay(from)} – ${formatDay(to)}`;
  if (fm !== tm) return `${fd} ${MONTHS[fm - 1]} – ${formatDay(to)}`;
  return `${fd} – ${formatDay(to)}`;
}
