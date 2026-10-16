import type { BackupConfig } from "@prisma/client";

import { atLocalTime, localDay } from "@/lib/dates";
import { type Schedule, scheduleSchema as anySchedule, timeOf } from "@/lib/schedule";
import { parseCron } from "@/modules/backups/cron";

/*
 * When backups run (v6.4, G1), in the schedule's timezone (Asia/Dhaka, which
 * has no daylight saving). The calculator itself is src/lib/schedule.ts
 * (shared with Bug Guard); this adds what only backups need: the default
 * (twice a day: every day at 02:00 and 14:00), at most every 12 hours, the
 * columns that store it, the monthly drill, and reading a v6.3 config whose
 * cron the owner had changed into the closest schedule, once
 * (scheduleFromCron); the scheduler then uses only this.
 */

export {
  describeSchedule,
  nextRunAt,
  previousRunAt,
  type Schedule,
  SCHEDULE_MODES,
  timesOnDay,
} from "@/lib/schedule";

export type BackupSchedule = Schedule;

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

const sortedUnique = <T>(values: T[]) => [...new Set(values)].sort();

/** The owner's backup schedule from the Backups screen: any schedule, at most every 12 hours apart. */
export const scheduleSchema = anySchedule.superRefine((s, ctx) => {
  if (s.mode === "HOURS" && s.every > 12) {
    ctx.addIssue({ code: "custom", path: ["every"], message: "Every 1 to 12 hours" });
  }
});

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
