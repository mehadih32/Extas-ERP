import { addDays, atLocalTime, daysBetween, localDay, localTime } from "@/lib/dates";
import { formatDay } from "@/lib/format";

/*
 * Repeating reminders ("every Monday", "on the 15th of every month"). The rule is
 * stored as a small subset of an iCalendar RRULE, e.g.
 * "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31;UNTIL=20261231", and every occurrence
 * keeps the wall-clock time and weekday or day of the month of the first one, in
 * company time. A monthly reminder on the 31st falls on the last day of shorter
 * months and goes back to the 31st after them; one on 29 February falls on
 * 28 February in other years.
 */

export const REPEAT_UNITS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export type Repeat = {
  every: RepeatUnit;
  /** Every 1, 2, 3... days / weeks / months / years. */
  interval: number;
  /** The last day it may fire on ("2026-12-31"), or null to repeat until cancelled. */
  until: string | null;
  /** Monthly and yearly: the day of the month it falls on (from the first occurrence). */
  monthDay: number | null;
};

const FREQ: Record<RepeatUnit, string> = {
  DAY: "DAILY",
  WEEK: "WEEKLY",
  MONTH: "MONTHLY",
  YEAR: "YEARLY",
};

export function formatRepeat(repeat: Repeat): string {
  const parts = [`FREQ=${FREQ[repeat.every]}`, `INTERVAL=${repeat.interval}`];
  if (repeat.monthDay && (repeat.every === "MONTH" || repeat.every === "YEAR")) {
    parts.push(`BYMONTHDAY=${repeat.monthDay}`);
  }
  if (repeat.until) parts.push(`UNTIL=${repeat.until.replace(/-/g, "")}`);
  return parts.join(";");
}

/** Reads a stored rule; null when there is none or it cannot be read. */
export function parseRepeat(rule: string | null | undefined): Repeat | null {
  if (!rule) return null;
  const fields = new Map(
    rule.split(";").map((part) => {
      const [key = "", value = ""] = part.split("=");
      return [key.trim().toUpperCase(), value.trim()] as const;
    }),
  );
  const every = REPEAT_UNITS.find((unit) => FREQ[unit] === fields.get("FREQ")?.toUpperCase());
  if (!every) return null;
  const interval = Number(fields.get("INTERVAL") ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return null;
  const monthDayRaw = fields.get("BYMONTHDAY");
  const monthDay = monthDayRaw === undefined ? null : Number(monthDayRaw);
  if (monthDay !== null && !(Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31)) {
    return null;
  }
  const untilRaw = fields.get("UNTIL");
  let until: string | null = null;
  if (untilRaw) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(untilRaw);
    if (!m) return null;
    until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return { every, interval, until, monthDay };
}

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The day `months` months after `day`, on `monthDay` (or the last day of a shorter month). */
function addMonths(day: string, months: number, monthDay: number): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const date = Math.min(monthDay, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

/** The day `steps` repeats after `day`. */
function step(day: string, repeat: Repeat, steps: number): string {
  const monthDay = repeat.monthDay ?? Number(day.slice(8, 10));
  switch (repeat.every) {
    case "DAY":
      return addDays(day, repeat.interval * steps);
    case "WEEK":
      return addDays(day, 7 * repeat.interval * steps);
    case "MONTH":
      return addMonths(day, repeat.interval * steps, monthDay);
    case "YEAR":
      return addMonths(day, 12 * repeat.interval * steps, monthDay);
  }
}

/**
 * When a repeating reminder is due next: the first occurrence after `after`
 * (usually now, so a reminder missed while the server was off fires once, not
 * once per missed day). `current` is when it was due last. Null when the series
 * has ended (past its UNTIL day).
 */
export function nextOccurrence(
  current: Date,
  repeat: Repeat,
  timeZone: string,
  after: Date,
): Date | null {
  const time = localTime(current, timeZone);
  let day = localDay(current, timeZone);
  // Days and weeks: jump straight to the period around `after`.
  if (repeat.every === "DAY" || repeat.every === "WEEK") {
    const period = (repeat.every === "DAY" ? 1 : 7) * repeat.interval;
    const behind = daysBetween(day, localDay(after, timeZone));
    if (behind > period) day = addDays(day, Math.floor(behind / period - 1) * period);
  }
  for (let i = 0; i < 2000; i++) {
    day = step(day, repeat, 1);
    if (repeat.until && day > repeat.until) return null;
    const at = atLocalTime(day, time, timeZone);
    if (at > after) return at;
  }
  return null;
}

/** "Every day", "Every 2 weeks", "Every month on day 15", "Every year until 31 Dec 2027". */
export function describeRepeat(repeat: Repeat): string {
  const unit = repeat.every.toLowerCase();
  const base = repeat.interval === 1 ? `Every ${unit}` : `Every ${repeat.interval} ${unit}s`;
  const on = repeat.monthDay && repeat.every === "MONTH" ? ` on day ${repeat.monthDay}` : "";
  return `${base}${on}${repeat.until ? ` until ${formatDay(repeat.until)}` : ""}`;
}
