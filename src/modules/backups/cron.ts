import { localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";

/*
 * A small 5-field cron reader for the backup schedule ("0 2 * * *" = every day
 * at 02:00): minute, hour, day of month, month, day of week (0 or 7 = Sunday).
 * Each field takes a star (any), a number, a range (1-5), a list (1,15) or a
 * step: "0-30/10", or a star followed by "/6" for every 6th. When both day
 * fields are set, either one matching is enough (as in standard cron). Times
 * are wall-clock times in the schedule's timezone.
 */

export type CronSpec = {
  minutes: number[];
  hours: number[];
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  anyDay: boolean;
  anyWeekday: boolean;
};

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
] as const;

function parseField(text: string, field: (typeof FIELDS)[number]): number[] {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`"${part}" is not a valid ${field.name}`);
    const [, all, from, to, step] = match;
    let start: number = field.min;
    let end: number = field.max;
    if (all !== "*") {
      start = Number(from);
      end = to !== undefined ? Number(to) : step !== undefined ? field.max : start;
    }
    const every = step !== undefined ? Number(step) : 1;
    if (start < field.min || end > field.max || start > end || every < 1) {
      throw new Error(`${field.name} must be between ${field.min} and ${field.max}`);
    }
    for (let v = start; v <= end; v += every) values.add(v);
  }
  return [...values].sort((a, b) => a - b);
}

export function parseCron(expression: string): CronSpec {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new AppError("VALIDATION", "A schedule has 5 parts: minute hour day month weekday.", {
      cronSchedule: ['Use 5 parts, e.g. "0 2 * * *" for every day at 02:00.'],
    });
  }
  try {
    const [minutes, hours, days, months, weekdays] = parts.map((p, i) => parseField(p, FIELDS[i]!));
    return {
      minutes: minutes!,
      hours: hours!,
      days: new Set(days),
      months: new Set(months),
      // 7 is Sunday too.
      weekdays: new Set(weekdays!.map((d) => (d === 7 ? 0 : d))),
      anyDay: parts[2] === "*",
      anyWeekday: parts[4] === "*",
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("VALIDATION", `Invalid schedule: ${(error as Error).message}.`, {
      cronSchedule: [(error as Error).message],
    });
  }
}

/** Whether the schedule runs on a calendar day ("YYYY-MM-DD"). */
function runsOnDay(spec: CronSpec, day: string): boolean {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  if (!spec.months.has(m)) return false;
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const dayOk = spec.days.has(d);
  const weekdayOk = spec.weekdays.has(weekday);
  if (spec.anyDay && spec.anyWeekday) return true;
  if (spec.anyDay) return weekdayOk;
  if (spec.anyWeekday) return dayOk;
  return dayOk || weekdayOk;
}

function shiftDay(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

/** Wall-clock hour and minute of an instant in `timeZone`. */
function clock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { hour: get("hour"), minute: get("minute") };
}

const at = (day: string, hour: number, minute: number, timeZone: string) =>
  new Date(startOfDayInZone(day, timeZone).getTime() + (hour * 60 + minute) * 60_000);

/** The latest scheduled time at or before `now` (searches back up to 400 days). */
export function previousRun(expression: string | CronSpec, timeZone: string, now = new Date()) {
  const spec = typeof expression === "string" ? parseCron(expression) : expression;
  const today = localDay(now, timeZone);
  const { hour: nowHour, minute: nowMinute } = clock(now, timeZone);
  for (let back = 0; back <= 400; back++) {
    const day = shiftDay(today, -back);
    if (!runsOnDay(spec, day)) continue;
    for (const hour of [...spec.hours].reverse()) {
      if (back === 0 && hour > nowHour) continue;
      for (const minute of [...spec.minutes].reverse()) {
        if (back === 0 && hour === nowHour && minute > nowMinute) continue;
        return at(day, hour, minute, timeZone);
      }
    }
  }
  return null;
}

/** The first scheduled time after `now` (searches ahead up to 400 days). */
export function nextRun(expression: string | CronSpec, timeZone: string, now = new Date()) {
  const spec = typeof expression === "string" ? parseCron(expression) : expression;
  const today = localDay(now, timeZone);
  const { hour: nowHour, minute: nowMinute } = clock(now, timeZone);
  for (let ahead = 0; ahead <= 400; ahead++) {
    const day = shiftDay(today, ahead);
    if (!runsOnDay(spec, day)) continue;
    for (const hour of spec.hours) {
      if (ahead === 0 && hour < nowHour) continue;
      for (const minute of spec.minutes) {
        if (ahead === 0 && hour === nowHour && minute <= nowMinute) continue;
        return at(day, hour, minute, timeZone);
      }
    }
  }
  return null;
}
