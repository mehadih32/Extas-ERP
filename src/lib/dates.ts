/*
 * Calendar-day helpers that respect the company's timezone (default Asia/Dhaka),
 * so "statement to 28 Feb" includes everything posted on 28 Feb local time.
 */

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** How far `timeZone` is ahead of UTC at `at`, in milliseconds. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value);
  const wallClockAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallClockAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a calendar day ("2026-02-28") starts in `timeZone`. */
export function startOfDayInZone(day: string, timeZone: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  const guess = new Date(utcMidnight.getTime() - zoneOffsetMs(utcMidnight, timeZone));
  // Re-check at the guessed instant in case a DST change falls in between.
  return new Date(utcMidnight.getTime() - zoneOffsetMs(guess, timeZone));
}

/** The calendar day after `day` ("2026-02-28" -> "2026-03-01"). */
export function nextDay(day: string): string {
  return addDays(day, 1);
}

/** The calendar day `days` after `day` (before it when negative). */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Turns a "from" / "to" filter into a half-open range [start, end). A plain day
 * covers the whole local day; a full timestamp is used as given (inclusive).
 */
export function dayRange(
  from: Date | string | undefined,
  to: Date | string | undefined,
  timeZone: string,
): { start?: Date; end?: Date } {
  const start =
    from === undefined
      ? undefined
      : typeof from === "string" && DATE_ONLY.test(from)
        ? startOfDayInZone(from, timeZone)
        : new Date(from);
  const end =
    to === undefined
      ? undefined
      : typeof to === "string" && DATE_ONLY.test(to)
        ? startOfDayInZone(nextDay(to), timeZone)
        : new Date(new Date(to).getTime() + 1);
  return { start, end };
}

/** The calendar day ("2026-02-28") an instant falls on in `timeZone`. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Whole calendar days from `from` to `to` ("YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A plain calendar day means the start of that day in company time; timestamps pass through. */
export function toInstant(value: Date | string, timeZone: string): Date {
  if (value instanceof Date) return value;
  return DATE_ONLY.test(value) ? startOfDayInZone(value, timeZone) : new Date(value);
}

/** "YYYY-MM-DD" of a @db.Date column (stored as midnight UTC). */
export function dateOnly(value: Date): string;
export function dateOnly(value: Date | null): string | null;
export function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** The value to write to a @db.Date column for a calendar day. */
export function dateColumn(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Day of the week of a calendar day: 0 = Sunday ... 6 = Saturday. */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Wall-clock time ("09:42") of an instant in `timeZone`. */
export function localTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** The instant a wall-clock time ("09:42") on a calendar day happens in `timeZone`. */
export function atLocalTime(day: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return new Date(startOfDayInZone(day, timeZone).getTime() + (h * 60 + m) * 60_000);
}
