import type { BackupConfig, BackupScheduleMode } from "@prisma/client";
import { z } from "zod";

import { addDays, atLocalTime, daysBetween, localDay, localTime, weekday } from "@/lib/dates";
import { parseCron } from "@/modules/backups/cron";

/*
 * When backups run (v6.4, G1), in the schedule's timezone (Asia/Dhaka, which
 * has no daylight saving):
 *   HOURS   every N hours from a start time, each day ("every 6 hours from 01:00":
 *           01:00, 07:00, 13:00, 19:00)
 *   DAYS    every N days at the chosen times (counted from a start day)
 *   WEEKLY  on the chosen weekdays at the chosen times
 *   DATES   on the dates and times listed
 * The default is twice a day: every day at 02:00 and 14:00. A v6.3 config whose
 * cron the owner had changed is read once into the closest of these
 * (scheduleFromCron); the scheduler then uses only this.
 */

export const SCHEDULE_MODES = ["HOURS", "DAYS", "WEEKLY", "DATES"] as const;

export type BackupSchedule = {
  mode: BackupScheduleMode;
  /** Hours (HOURS) or days (DAYS) between backups. */
  every: number;
  /** "HH:MM", sorted; for HOURS only the first one (the start time). */
  times: string[];
  /** 0 = Sunday ... 6 = Saturday (WEEKLY). */
  weekdays: number[];
  /** "YYYY-MM-DD HH:MM", sorted (DATES). */
  dates: string[];
  /** The first day of an every-N-days schedule ("YYYY-MM-DD"); null: N = 1. */
  startDay: string | null;
};

export const DEFAULT_SCHEDULE: BackupSchedule = {
  mode: "DAYS",
  every: 1,
  times: ["02:00", "14:00"],
  weekdays: [],
  dates: [],
  startDay: null,
};

/** v6.3's default: every day at 02:00. A config still on it takes the new default. */
export const V63_DEFAULT_CRON = "0 2 * * *";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const sortedUnique = <T>(values: T[]) => [...new Set(values)].sort();

function validDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** The owner's schedule from the Backups screen, checked and put in order. */
export const scheduleSchema = z
  .object({
    mode: z.enum(SCHEDULE_MODES),
    every: z.coerce.number().int().min(1, "Give at least 1").max(30, "Give at most 30").default(1),
    times: z
      .array(z.string().trim().regex(TIME, "Use a time like 02:00"))
      .max(12, "Give at most 12 times a day")
      .default([]),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
    dates: z
      .array(z.string().trim().regex(DATE_TIME, "Use a date and time like 2026-11-01 02:00"))
      .max(60, "Give at most 60 dates")
      .default([]),
    startDay: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
  })
  .superRefine((s, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (s.mode === "HOURS") {
      if (s.times.length !== 1) issue("times", "Give the one time the day starts from");
      if (s.every > 12) issue("every", "Every 1 to 12 hours");
    }
    if ((s.mode === "DAYS" || s.mode === "WEEKLY") && s.times.length === 0) {
      issue("times", "Give at least one time");
    }
    if (s.mode === "WEEKLY" && s.weekdays.length === 0) issue("weekdays", "Pick at least one day");
    if (s.mode === "DATES") {
      if (s.dates.length === 0) issue("dates", "Give at least one date and time");
      for (const d of s.dates) {
        if (!validDay(d.slice(0, 10))) issue("dates", `${d} is not a real date`);
      }
    }
    if (s.startDay && !validDay(s.startDay)) issue("startDay", "Not a real date");
  })
  .transform((s): BackupSchedule => ({
    mode: s.mode,
    every: s.mode === "HOURS" || s.mode === "DAYS" ? s.every : 1,
    times: s.mode === "DATES" ? [] : sortedUnique(s.times),
    weekdays: s.mode === "WEEKLY" ? [...new Set(s.weekdays)].sort((a, b) => a - b) : [],
    dates: s.mode === "DATES" ? sortedUnique(s.dates) : [],
    startDay: s.mode === "DAYS" && s.every > 1 ? (s.startDay ?? null) : null,
  }));

/** The times "HH:MM" a schedule runs on one calendar day, in order. */
export function timesOnDay(schedule: BackupSchedule, day: string): string[] {
  switch (schedule.mode) {
    case "HOURS": {
      const start = minutesOf(schedule.times[0] ?? "00:00");
      const step = Math.max(1, schedule.every) * 60;
      const out: string[] = [];
      for (let m = start; m < 24 * 60; m += step) out.push(timeOf(m));
      return out;
    }
    case "DAYS": {
      const every = Math.max(1, schedule.every);
      if (every > 1) {
        const from = schedule.startDay ?? day;
        const gap = daysBetween(from, day);
        if (((gap % every) + every) % every !== 0) return [];
      }
      return schedule.times;
    }
    case "WEEKLY":
      return schedule.weekdays.includes(weekday(day)) ? schedule.times : [];
    case "DATES":
      return schedule.dates.filter((d) => d.startsWith(day)).map((d) => d.slice(11));
  }
}

/** Days searched back or ahead for a scheduled time. */
const SEARCH_DAYS = 400;

/** The latest scheduled time at or before `now`; null when there is none. */
export function previousRunAt(
  schedule: BackupSchedule,
  timeZone: string,
  now = new Date(),
): Date | null {
  if (schedule.mode === "DATES") {
    const past = schedule.dates
      .map((d) => atLocalTime(d.slice(0, 10), d.slice(11), timeZone))
      .filter((at) => at <= now);
    return past.length ? new Date(Math.max(...past.map((d) => d.getTime()))) : null;
  }
  const today = localDay(now, timeZone);
  const clock = localTime(now, timeZone);
  for (let back = 0; back <= SEARCH_DAYS; back++) {
    const day = addDays(today, -back);
    const times = [...timesOnDay(schedule, day)].reverse();
    const time = back === 0 ? times.find((t) => t <= clock) : times[0];
    if (time) return atLocalTime(day, time, timeZone);
  }
  return null;
}

/** The first scheduled time after `now`; null when there is none (DATES all past). */
export function nextRunAt(
  schedule: BackupSchedule,
  timeZone: string,
  now = new Date(),
): Date | null {
  if (schedule.mode === "DATES") {
    const ahead = schedule.dates
      .map((d) => atLocalTime(d.slice(0, 10), d.slice(11), timeZone))
      .filter((at) => at > now);
    return ahead.length ? new Date(Math.min(...ahead.map((d) => d.getTime()))) : null;
  }
  const today = localDay(now, timeZone);
  const clock = localTime(now, timeZone);
  for (let ahead = 0; ahead <= SEARCH_DAYS; ahead++) {
    const day = addDays(today, ahead);
    const times = timesOnDay(schedule, day);
    // The current minute has already come (localTime drops the seconds).
    const time = ahead === 0 ? times.find((t) => t > clock) : times[0];
    if (time) return atLocalTime(day, time, timeZone);
  }
  return null;
}

/** The schedule in plain words, for the screen ("Every day at 02:00 and 14:00"). */
export function describeSchedule(schedule: BackupSchedule): string {
  const list = (items: string[]) =>
    items.length <= 1
      ? (items[0] ?? "")
      : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  switch (schedule.mode) {
    case "HOURS": {
      const times = timesOnDay(schedule, "2026-01-01");
      return schedule.every === 1
        ? `Every hour from ${schedule.times[0]}`
        : `Every ${schedule.every} hours from ${schedule.times[0]} (${list(times)})`;
    }
    case "DAYS":
      return schedule.every === 1
        ? `Every day at ${list(schedule.times)}`
        : `Every ${schedule.every} days at ${list(schedule.times)}`;
    case "WEEKLY":
      return `Every ${list(schedule.weekdays.map((d) => WEEKDAY_NAMES[d]!))} at ${list(schedule.times)}`;
    case "DATES":
      return schedule.dates.length === 1
        ? `Once, on ${schedule.dates[0]}`
        : `On ${schedule.dates.length} chosen dates, from ${schedule.dates[0]} to ${schedule.dates.at(-1)}`;
  }
}

/** The closest v6.4 schedule to a v6.3 cron (always at least as often, never less). */
export function scheduleFromCron(cron: string, now = new Date()): BackupSchedule {
  if (cron.trim() === V63_DEFAULT_CRON) return { ...DEFAULT_SCHEDULE, times: ["02:00"] };
  let spec: ReturnType<typeof parseCron>;
  try {
    spec = parseCron(cron);
  } catch {
    return DEFAULT_SCHEDULE;
  }
  const minute = spec.minutes[0] ?? 0;
  const hours = spec.hours;
  // Hours in steps through the day ("0 */6 * * *", "30 1-23/4 * * *").
  const step = hours.length > 1 ? hours[1]! - hours[0]! : 0;
  const evenSteps =
    cron.trim().split(/\s+/)[1]!.includes("/") &&
    spec.minutes.length === 1 &&
    hours.length > 1 &&
    hours.every((h, i) => h === hours[0]! + i * step) &&
    hours.at(-1)! + step >= 24;
  const times = sortedUnique(hours.flatMap((h) => spec.minutes.map((m) => timeOf(h * 60 + m))));
  const sameEveryDay = spec.anyDay && spec.anyWeekday;
  if (evenSteps && sameEveryDay && step <= 12) {
    return {
      ...DEFAULT_SCHEDULE,
      mode: "HOURS",
      every: step,
      times: [timeOf(hours[0]! * 60 + minute)],
    };
  }
  // More than 12 times a day: every hour from the first one.
  if (times.length > 12) {
    return { ...DEFAULT_SCHEDULE, mode: "HOURS", every: 1, times: [times[0]!] };
  }
  if (spec.anyDay && !spec.anyWeekday) {
    return {
      ...DEFAULT_SCHEDULE,
      mode: "WEEKLY",
      weekdays: [...spec.weekdays].sort((a, b) => a - b),
      times,
    };
  }
  if (!spec.anyDay && spec.anyWeekday) {
    // Days of the month ("0 2 1,15 * *"): as often, every N days from the next one.
    const every = Math.max(1, Math.min(30, Math.round(30 / spec.days.size)));
    const first = Math.min(...spec.days);
    const today = now.toISOString().slice(0, 10);
    const startDay = `${today.slice(0, 8)}${String(Math.min(first, 28)).padStart(2, "0")}`;
    return { ...DEFAULT_SCHEDULE, mode: "DAYS", every, times, startDay };
  }
  // Every day (and anything less usual): every day at the cron's times.
  return { ...DEFAULT_SCHEDULE, mode: "DAYS", every: 1, times };
}

/** The schedule a config runs on: its own, else read from its v6.3 cron. */
export function scheduleOf(
  config: Pick<
    BackupConfig,
    | "scheduleMode"
    | "scheduleEvery"
    | "scheduleTimes"
    | "scheduleWeekdays"
    | "scheduleDates"
    | "scheduleStartDay"
    | "cronSchedule"
  >,
): BackupSchedule {
  if (!config.scheduleMode) {
    return config.cronSchedule.trim() === V63_DEFAULT_CRON
      ? DEFAULT_SCHEDULE
      : scheduleFromCron(config.cronSchedule);
  }
  return {
    mode: config.scheduleMode,
    every: config.scheduleEvery,
    times: config.scheduleTimes,
    weekdays: config.scheduleWeekdays,
    dates: config.scheduleDates,
    startDay: config.scheduleStartDay,
  };
}

/** The columns that store a schedule. */
export function scheduleColumns(schedule: BackupSchedule) {
  return {
    scheduleMode: schedule.mode,
    scheduleEvery: schedule.every,
    scheduleTimes: schedule.times,
    scheduleWeekdays: schedule.weekdays,
    scheduleDates: schedule.dates,
    scheduleStartDay: schedule.startDay,
  };
}

/** The monthly drill's schedule: day 1 to 28 of each month at a time. */
export function drillDueAt(
  config: Pick<BackupConfig, "drillDay" | "drillTime">,
  timeZone: string,
  now = new Date(),
): Date {
  const today = localDay(now, timeZone);
  const day = String(Math.min(Math.max(config.drillDay, 1), 28)).padStart(2, "0");
  const thisMonth = `${today.slice(0, 8)}${day}`;
  const at = atLocalTime(thisMonth, config.drillTime, timeZone);
  if (at <= now) return at;
  const [y, m] = today.split("-").map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return atLocalTime(`${prev}-${day}`, config.drillTime, timeZone);
}

/** The drill's next time after `now`. */
export function nextDrillAt(
  config: Pick<BackupConfig, "drillDay" | "drillTime">,
  timeZone: string,
  now = new Date(),
): Date {
  const due = drillDueAt(config, timeZone, now);
  const [y, m] = localDay(due, timeZone).split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const day = String(Math.min(Math.max(config.drillDay, 1), 28)).padStart(2, "0");
  return atLocalTime(`${next}-${day}`, config.drillTime, timeZone);
}
