import { weekday } from "@/lib/dates";
import { addDays, monthEnd, monthsBetween } from "@/modules/accounts/periods";

/*
 * The company's working calendar: weekly days off (Friday by default) and
 * holidays are paid days off; every other day is a working day. Leave counts
 * working days only, and payroll evaluates attendance on working days. Pure
 * functions over "YYYY-MM-DD" calendar days.
 */

export type HrCalendar = {
  /** 0 = Sunday ... 6 = Saturday. */
  weeklyOffDays: readonly number[];
  /** Holiday dates, "YYYY-MM-DD". */
  holidays: ReadonlySet<string>;
};

export type DayType = "WORKING" | "WEEKLY_OFF" | "HOLIDAY";

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** "Friday" for 5. */
export function weekdayName(day: number): string {
  return WEEKDAY_NAMES[day] ?? String(day);
}

export function dayType(calendar: HrCalendar, day: string): DayType {
  if (calendar.holidays.has(day)) return "HOLIDAY";
  if (calendar.weeklyOffDays.includes(weekday(day))) return "WEEKLY_OFF";
  return "WORKING";
}

export function isWorkingDay(calendar: HrCalendar, day: string): boolean {
  return dayType(calendar, day) === "WORKING";
}

/** Every calendar day from `from` to `to`, both included. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** "2026-10" -> first and last day and the number of days. */
export function monthRange(month: string): { from: string; to: string; days: number } {
  const from = `${month}-01`;
  const to = monthEnd(from);
  return { from, to, days: Number(to.slice(8, 10)) };
}

/** The months ("2026-10") a period touches. */
export function monthsOf(from: string, to: string): string[] {
  return monthsBetween(from, to);
}

/** "October 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Working days in a leave request: weekly days off and holidays are skipped. */
export function leaveDayCount(
  calendar: HrCalendar,
  leave: { startDate: string; endDate: string; halfDay: boolean },
): number {
  const working = eachDay(leave.startDate, leave.endDate).filter((d) =>
    isWorkingDay(calendar, d),
  ).length;
  return leave.halfDay ? working * 0.5 : working;
}

/** Rounds to the nearest half day. */
export function toHalfDays(value: number): number {
  return Math.round(value * 2) / 2;
}
