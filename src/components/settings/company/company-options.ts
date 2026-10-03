/*
 * Choices for the company settings screen. The server accepts any three-letter
 * currency code and any time zone it knows; these lists are the common ones,
 * plus whatever the company already uses.
 */

export const CURRENCIES = [
  ["BDT", "Bangladeshi taka (BDT)"],
  ["USD", "US dollar (USD)"],
  ["EUR", "Euro (EUR)"],
  ["GBP", "Pound sterling (GBP)"],
  ["INR", "Indian rupee (INR)"],
  ["CNY", "Chinese yuan (CNY)"],
  ["AED", "UAE dirham (AED)"],
  ["SAR", "Saudi riyal (SAR)"],
  ["MYR", "Malaysian ringgit (MYR)"],
  ["SGD", "Singapore dollar (SGD)"],
  ["JPY", "Japanese yen (JPY)"],
  ["CAD", "Canadian dollar (CAD)"],
  ["AUD", "Australian dollar (AUD)"],
] as const;

export const MONTHS = [
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
] as const;

/** The currency choices, with the company's own first if it is not a common one. */
export function currencyChoices(current: string): Array<readonly [string, string]> {
  return CURRENCIES.some(([code]) => code === current)
    ? [...CURRENCIES]
    : [[current, current] as const, ...CURRENCIES];
}

/**
 * Every time zone this server knows ("Asia/Dhaka"), with the company's own
 * included. Built on the server and handed to the form, so the page and the
 * browser show the same list.
 */
export function timeZoneChoices(current: string): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(current) ? zones : [current, ...zones];
}
