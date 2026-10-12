/*
 * How long someone has been with the company, for the tenure clock on the
 * employee dashboard: whole years, months and days from the join day (as a
 * calendar counts them), and the next work anniversary. Days are "YYYY-MM-DD"
 * in company time.
 */

export type Tenure = { years: number; months: number; days: number; totalDays: number };

const parts = (day: string) => day.split("-").map(Number) as [number, number, number];

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const totalDaysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The same day of the month `months` after `joined` (the 31st falls back to the month's last day). */
function monthsAfter(joined: string, months: number): string {
  const [jy, jm, jd] = parts(joined);
  const index = jy * 12 + (jm - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const d = Math.min(jd, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Years, months and days from `joined` to `day` (zero before the join day). */
export function tenureOn(joined: string, day: string): Tenure {
  if (day <= joined) return { years: 0, months: 0, days: 0, totalDays: 0 };
  const [jy, jm] = parts(joined);
  const [y, m] = parts(day);
  let months = (y - jy) * 12 + (m - jm);
  if (monthsAfter(joined, months) > day) months -= 1;
  return {
    years: Math.floor(months / 12),
    months: months % 12,
    days: totalDaysBetween(monthsAfter(joined, months), day),
    totalDays: totalDaysBetween(joined, day),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "2 years, 3 months and 12 days", "5 days", "Joined today". */
export function tenureText(t: Tenure): string {
  const bits = [
    t.years > 0 ? plural(t.years, "year") : null,
    t.months > 0 ? plural(t.months, "month") : null,
    t.days > 0 ? plural(t.days, "day") : null,
  ].filter((b): b is string => b !== null);
  if (bits.length === 0) return "Joined today";
  return bits.length === 1 ? bits[0]! : `${bits.slice(0, -1).join(", ")} and ${bits.at(-1)}`;
}

/**
 * The next work anniversary after `day` (29 Feb joiners count on 28 Feb in
 * other years): its day, which one it is and how many days are left.
 */
export function nextAnniversary(joined: string, day: string) {
  const [jy, jm, jd] = parts(joined);
  const [y] = parts(day);
  const on = (year: number) => {
    const d = Math.min(jd, daysInMonth(year, jm));
    return `${year}-${String(jm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let year = Math.max(y, jy + 1);
  if (on(year) <= day) year += 1;
  const date = on(year);
  return { date, years: year - jy, inDays: totalDaysBetween(day, date) };
}
