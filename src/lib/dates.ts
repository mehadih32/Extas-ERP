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
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
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
