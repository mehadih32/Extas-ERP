import { z } from "zod";

import { addDays, atLocalTime, daysBetween, localDay, localTime, weekday } from "@/lib/dates";

/*
 * A schedule the owner sets, and when it next (or last) runs, in a timezone
 * (Asia/Dhaka has no daylight saving). Shared by backups and Bug Guard; no
 * database and nothing from the modules here.
 *   HOURS   every N hours (1 to 24) from a start time, each day ("every 6 hours
 *           from 01:00": 01:00, 07:00, 13:00, 19:00)
 *   DAYS    every N days (1 to 30) at the chosen times, counted from a start day
 *   WEEKLY  on the chosen weekdays at the chosen times
 *   DATES   on the dates and times listed
 */

export const SCHEDULE_MODES = ["HOURS", "DAYS", "WEEKLY", "DATES"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

export type Schedule = {
  mode: ScheduleMode;
  /** Hours (HOURS) or days (DAYS) between runs. */
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
export const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const sortedUnique = <T>(values: T[]) => [...new Set(values)].sort();

function validDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** A schedule as typed on a screen, checked and put in order. */
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
      if (s.every > 24) issue("every", "Every 1 to 24 hours");
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
  .transform((s): Schedule => ({
    mode: s.mode,
    every: s.mode === "HOURS" || s.mode === "DAYS" ? s.every : 1,
    times: s.mode === "DATES" ? [] : sortedUnique(s.times),
    weekdays: s.mode === "WEEKLY" ? [...new Set(s.weekdays)].sort((a, b) => a - b) : [],
    dates: s.mode === "DATES" ? sortedUnique(s.dates) : [],
    startDay: s.mode === "DAYS" && s.every > 1 ? (s.startDay ?? null) : null,
  }));

/** The times "HH:MM" a schedule runs on one calendar day, in order. */
export function timesOnDay(schedule: Schedule, day: string): string[] {
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
export function previousRunAt(schedule: Schedule, timeZone: string, now = new Date()): Date | null {
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
export function nextRunAt(schedule: Schedule, timeZone: string, now = new Date()): Date | null {
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

/** The schedule in plain words, for a screen ("Every day at 02:00 and 14:00"). */
export function describeSchedule(schedule: Schedule): string {
  const list = (items: string[]) =>
    items.length <= 1
      ? (items[0] ?? "")
      : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  switch (schedule.mode) {
    case "HOURS": {
      const times = timesOnDay(schedule, "2026-01-01");
      if (schedule.every === 1) return `Every hour from ${schedule.times[0]}`;
      if (times.length === 1) return `Every day at ${schedule.times[0]}`;
      return `Every ${schedule.every} hours from ${schedule.times[0]} (${list(times)})`;
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
