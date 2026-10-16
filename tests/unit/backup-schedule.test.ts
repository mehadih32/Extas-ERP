import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  type BackupSchedule,
  DEFAULT_SCHEDULE,
  describeSchedule,
  drillDueAt,
  nextDrillAt,
  nextRunAt,
  previousRunAt,
  scheduleFromCron,
  scheduleOf,
  scheduleSchema,
  timesOnDay,
} from "@/modules/backups/schedule";

/*
 * G1: the backup schedule, fully custom. Times are Asia/Dhaka wall-clock times;
 * Dhaka is UTC+6 all year (no daylight saving), so every instant below is the
 * Dhaka time minus 6 hours.
 */

const TZ = "Asia/Dhaka";
/** An instant from a Dhaka wall-clock time ("2026-10-02 01:30"). */
const dhaka = (text: string) => new Date(`${text.replace(" ", "T")}:00+06:00`);
const iso = (d: Date | null) => d?.toISOString() ?? null;
const schedule = (input: Record<string, unknown>) => scheduleSchema.parse(input);

describe("the default schedule", () => {
  it("is twice a day: every day at 02:00 and 14:00 Dhaka time", () => {
    expect(DEFAULT_SCHEDULE).toMatchObject({ mode: "DAYS", every: 1, times: ["02:00", "14:00"] });
    expect(describeSchedule(DEFAULT_SCHEDULE)).toBe("Every day at 02:00 and 14:00");
    const now = dhaka("2026-10-02 09:15");
    expect(iso(previousRunAt(DEFAULT_SCHEDULE, TZ, now))).toBe(iso(dhaka("2026-10-02 02:00")));
    expect(iso(nextRunAt(DEFAULT_SCHEDULE, TZ, now))).toBe(iso(dhaka("2026-10-02 14:00")));
    // Exactly at a scheduled minute: that one is the latest, the next is the following one.
    const two = dhaka("2026-10-02 14:00");
    expect(iso(previousRunAt(DEFAULT_SCHEDULE, TZ, two))).toBe(iso(two));
    expect(iso(nextRunAt(DEFAULT_SCHEDULE, TZ, two))).toBe(iso(dhaka("2026-10-03 02:00")));
    // Dhaka has no daylight saving: 02:00 Dhaka is 20:00 UTC the day before, all year.
    for (const day of ["2026-01-15", "2026-04-01", "2026-07-15", "2026-10-30"]) {
      expect(iso(nextRunAt(DEFAULT_SCHEDULE, TZ, dhaka(`${day} 00:00`)))).toBe(
        new Date(`${day}T02:00:00+06:00`).toISOString(),
      );
    }
  });
});

describe("every N hours from a start time", () => {
  const sixHours = schedule({ mode: "HOURS", every: 6, times: ["01:00"] });

  it("runs from the start time each day", () => {
    expect(timesOnDay(sixHours, "2026-10-02")).toEqual(["01:00", "07:00", "13:00", "19:00"]);
    expect(describeSchedule(sixHours)).toBe(
      "Every 6 hours from 01:00 (01:00, 07:00, 13:00 and 19:00)",
    );
    expect(iso(nextRunAt(sixHours, TZ, dhaka("2026-10-02 19:30")))).toBe(
      iso(dhaka("2026-10-03 01:00")),
    );
    expect(iso(previousRunAt(sixHours, TZ, dhaka("2026-10-03 00:59")))).toBe(
      iso(dhaka("2026-10-02 19:00")),
    );
  });

  it("starts again at the start time when the hours do not divide the day", () => {
    const five = schedule({ mode: "HOURS", every: 5, times: ["00:30"] });
    expect(timesOnDay(five, "2026-10-02")).toEqual(["00:30", "05:30", "10:30", "15:30", "20:30"]);
    expect(iso(nextRunAt(five, TZ, dhaka("2026-10-02 21:00")))).toBe(
      iso(dhaka("2026-10-03 00:30")),
    );
  });

  it("refuses more than 12 hours or more than one start time", () => {
    expect(() => schedule({ mode: "HOURS", every: 13, times: ["01:00"] })).toThrow(ZodError);
    expect(() => schedule({ mode: "HOURS", every: 2, times: ["01:00", "02:00"] })).toThrow(
      ZodError,
    );
  });
});

describe("every N days at chosen times", () => {
  it("counts the days from the start day", () => {
    const three = schedule({
      mode: "DAYS",
      every: 3,
      times: ["14:00", "02:00", "02:00"],
      startDay: "2026-10-01",
    });
    expect(three.times).toEqual(["02:00", "14:00"]);
    expect(describeSchedule(three)).toBe("Every 3 days at 02:00 and 14:00");
    expect(timesOnDay(three, "2026-10-01")).toEqual(["02:00", "14:00"]);
    expect(timesOnDay(three, "2026-10-02")).toEqual([]);
    expect(timesOnDay(three, "2026-10-04")).toEqual(["02:00", "14:00"]);
    // Days before the start day follow the same rhythm.
    expect(timesOnDay(three, "2026-09-28")).toEqual(["02:00", "14:00"]);
    expect(iso(nextRunAt(three, TZ, dhaka("2026-10-01 15:00")))).toBe(
      iso(dhaka("2026-10-04 02:00")),
    );
    expect(iso(previousRunAt(three, TZ, dhaka("2026-10-03 23:00")))).toBe(
      iso(dhaka("2026-10-01 14:00")),
    );
  });

  it("needs at least one time", () => {
    expect(() => schedule({ mode: "DAYS", every: 1, times: [] })).toThrow(ZodError);
    expect(() => schedule({ mode: "DAYS", every: 31, times: ["02:00"] })).toThrow(ZodError);
    expect(() => schedule({ mode: "DAYS", every: 1, times: ["24:00"] })).toThrow(ZodError);
  });
});

describe("weekly on chosen days", () => {
  it("runs on those weekdays only", () => {
    // Sunday and Wednesday at 03:00. 2 October 2026 is a Friday.
    const weekly = schedule({ mode: "WEEKLY", weekdays: [3, 0], times: ["03:00"] });
    expect(weekly.weekdays).toEqual([0, 3]);
    expect(describeSchedule(weekly)).toBe("Every Sunday and Wednesday at 03:00");
    expect(iso(nextRunAt(weekly, TZ, dhaka("2026-10-02 12:00")))).toBe(
      iso(dhaka("2026-10-04 03:00")),
    );
    expect(iso(previousRunAt(weekly, TZ, dhaka("2026-10-02 12:00")))).toBe(
      iso(dhaka("2026-09-30 03:00")),
    );
    expect(() => schedule({ mode: "WEEKLY", weekdays: [], times: ["03:00"] })).toThrow(ZodError);
  });
});

describe("custom dates and times", () => {
  it("runs on each date listed, and not after the last", () => {
    const dates = schedule({
      mode: "DATES",
      dates: ["2026-11-01 02:00", "2026-10-20 23:30"],
    });
    expect(dates.dates).toEqual(["2026-10-20 23:30", "2026-11-01 02:00"]);
    expect(describeSchedule(dates)).toBe(
      "On 2 chosen dates, from 2026-10-20 23:30 to 2026-11-01 02:00",
    );
    expect(iso(nextRunAt(dates, TZ, dhaka("2026-10-16 10:00")))).toBe(
      iso(dhaka("2026-10-20 23:30")),
    );
    expect(iso(previousRunAt(dates, TZ, dhaka("2026-10-25 10:00")))).toBe(
      iso(dhaka("2026-10-20 23:30")),
    );
    expect(nextRunAt(dates, TZ, dhaka("2026-11-02 00:00"))).toBeNull();
    expect(previousRunAt(dates, TZ, dhaka("2026-10-01 00:00"))).toBeNull();
    expect(() => schedule({ mode: "DATES", dates: ["2026-02-30 02:00"] })).toThrow(ZodError);
    expect(() => schedule({ mode: "DATES", dates: [] })).toThrow(ZodError);
  });
});

describe("a v6.3 schedule the owner had changed", () => {
  const now = new Date("2026-10-16T06:00:00Z");
  const from = (cron: string) => scheduleFromCron(cron, now);
  const shape = (s: BackupSchedule) => ({
    mode: s.mode,
    every: s.every,
    times: s.times,
    weekdays: s.weekdays,
  });

  it("becomes the closest new schedule, never less often", () => {
    expect(shape(from("30 3 * * *"))).toEqual({
      mode: "DAYS",
      every: 1,
      times: ["03:30"],
      weekdays: [],
    });
    expect(shape(from("0 2,14 * * *"))).toEqual({
      mode: "DAYS",
      every: 1,
      times: ["02:00", "14:00"],
      weekdays: [],
    });
    expect(shape(from("0 */6 * * *"))).toEqual({
      mode: "HOURS",
      every: 6,
      times: ["00:00"],
      weekdays: [],
    });
    expect(shape(from("15 1-23/4 * * *"))).toEqual({
      mode: "HOURS",
      every: 4,
      times: ["01:15"],
      weekdays: [],
    });
    expect(shape(from("0 3 * * 1,4"))).toEqual({
      mode: "WEEKLY",
      every: 1,
      times: ["03:00"],
      weekdays: [1, 4],
    });
    // Sunday as 7 is Sunday.
    expect(from("0 3 * * 7").weekdays).toEqual([0]);
    // Every 15 minutes: more than 12 a day, so every hour.
    expect(shape(from("*/15 * * * *"))).toEqual({
      mode: "HOURS",
      every: 1,
      times: ["00:00"],
      weekdays: [],
    });
    // Days of the month: as often, every N days.
    const monthly = from("0 2 1 * *");
    expect(monthly).toMatchObject({ mode: "DAYS", every: 30, times: ["02:00"] });
    expect(monthly.startDay).toBe("2026-10-01");
    expect(from("0 2 1,15 * *")).toMatchObject({ mode: "DAYS", every: 15 });
    // Both day fields: every day at its time.
    expect(shape(from("0 3 1 * 1"))).toEqual({
      mode: "DAYS",
      every: 1,
      times: ["03:00"],
      weekdays: [],
    });
    // v6.3's own default, read as itself.
    expect(shape(from("0 2 * * *"))).toEqual({
      mode: "DAYS",
      every: 1,
      times: ["02:00"],
      weekdays: [],
    });
    // Something unreadable: the default, twice a day.
    expect(from("not a cron")).toEqual(DEFAULT_SCHEDULE);
  });

  it("is read from the config only while it has no new schedule", () => {
    const base = {
      scheduleMode: null,
      scheduleEvery: 1,
      scheduleTimes: ["02:00", "14:00"],
      scheduleWeekdays: [],
      scheduleDates: [],
      scheduleStartDay: null,
    };
    // Still v6.3's default (a row made before the migration ran): the new default.
    expect(scheduleOf({ ...base, cronSchedule: "0 2 * * *" })).toEqual(DEFAULT_SCHEDULE);
    expect(scheduleOf({ ...base, cronSchedule: "30 3 * * *" }).times).toEqual(["03:30"]);
    expect(
      scheduleOf({
        ...base,
        scheduleMode: "WEEKLY",
        scheduleWeekdays: [5],
        scheduleTimes: ["01:00"],
        cronSchedule: "30 3 * * *",
      }),
    ).toMatchObject({ mode: "WEEKLY", weekdays: [5], times: ["01:00"] });
  });
});

describe("the monthly drill", () => {
  it("is due on the chosen day of each month at the chosen time", () => {
    const config = { drillDay: 1, drillTime: "04:00" };
    expect(iso(drillDueAt(config, TZ, dhaka("2026-10-16 10:00")))).toBe(
      iso(dhaka("2026-10-01 04:00")),
    );
    // Before 04:00 on the 1st, the latest one is last month's.
    expect(iso(drillDueAt(config, TZ, dhaka("2026-10-01 03:59")))).toBe(
      iso(dhaka("2026-09-01 04:00")),
    );
    expect(iso(drillDueAt(config, TZ, dhaka("2026-01-01 03:00")))).toBe(
      iso(dhaka("2025-12-01 04:00")),
    );
    expect(iso(nextDrillAt(config, TZ, dhaka("2026-12-16 10:00")))).toBe(
      iso(dhaka("2027-01-01 04:00")),
    );
  });
});
