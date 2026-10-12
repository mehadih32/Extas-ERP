import { addDays, atLocalTime } from "@/lib/dates";
import type { DayType } from "@/modules/hr/calendar";
import { checkAgainstPlaces, type Ping, type Place } from "@/modules/hr/geo";

/*
 * Shadow overtime: what the app counts as overtime from a self check-out, for
 * HR to approve. Staying after the end of the working day counts from the end
 * time; on a weekly day off or a holiday the whole time worked counts. Short
 * stays (under the company's minimum) are ignored, and overtime is counted in
 * whole 15-minute steps. Pure functions, no database.
 */

/** Overtime is counted in whole steps of this many minutes. */
export const OVERTIME_STEP_MINUTES = 15;
/** The longest overtime HR can approve for one day. */
export const MAX_OVERTIME_MINUTES = 16 * 60;

export type OvertimeRules = {
  officeStartTime: string;
  officeEndTime: string;
  /** Stays shorter than this are not overtime. */
  overtimeMinMinutes: number;
};

export type OvertimeBasis = "AFTER_HOURS" | "DAY_OFF";

export type FoundOvertime = {
  basis: OvertimeBasis;
  /** When overtime started counting. */
  startsAt: Date;
  minutes: number;
};

/**
 * Hours typed by HR ("1.5", "1:30", "2h" or "90m") as minutes; null when it
 * is not overtime HR can approve (at least a minute, up to 16 hours).
 */
export function readHours(text: string): number | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, "");
  let minutes: number;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2]);
  else if (/^\d{1,4}m$/.test(value)) minutes = Number(value.slice(0, -1));
  else if (/^\d{1,2}(\.\d{1,2})?h?$/.test(value)) minutes = Math.round(parseFloat(value) * 60);
  else return null;
  return minutes >= 1 && minutes <= MAX_OVERTIME_MINUTES ? minutes : null;
}

/** Whole steps only: 74 minutes is 1 h, 76 is 1 h 15 min. */
export function roundOvertime(minutes: number): number {
  if (!(minutes > 0)) return 0;
  return Math.floor(minutes / OVERTIME_STEP_MINUTES) * OVERTIME_STEP_MINUTES;
}

/**
 * When the working day that starts on `day` ends. A day ending at or before
 * it starts (a night shift, 20:00 to 05:00) ends the next morning.
 */
export function shiftEndOn(day: string, rules: OvertimeRules, timeZone: string): Date {
  const endsNextDay = rules.officeEndTime <= rules.officeStartTime;
  return atLocalTime(endsNextDay ? addDays(day, 1) : day, rules.officeEndTime, timeZone);
}

/**
 * The overtime in one day's check-in and check-out, or null when there is
 * none worth counting.
 */
export function findOvertime(input: {
  day: string;
  dayType: DayType;
  checkIn: Date;
  checkOut: Date;
  rules: OvertimeRules;
  timeZone: string;
}): FoundOvertime | null {
  const { checkIn, checkOut, rules } = input;
  if (checkOut <= checkIn) return null;
  const basis: OvertimeBasis = input.dayType === "WORKING" ? "AFTER_HOURS" : "DAY_OFF";
  const end = shiftEndOn(input.day, rules, input.timeZone);
  const startsAt =
    basis === "DAY_OFF" ? checkIn : new Date(Math.max(end.getTime(), checkIn.getTime()));
  const stayed = (checkOut.getTime() - startsAt.getTime()) / 60_000;
  if (stayed < Math.max(rules.overtimeMinMinutes, 1)) return null;
  const minutes = Math.min(roundOvertime(stayed), MAX_OVERTIME_MINUTES);
  return minutes > 0 ? { basis, startsAt, minutes } : null;
}

export type TrailCheck = {
  /** The last position at the work place after overtime started, if any. */
  lastAtPlace: Date | null;
  /** Overtime up to that moment, when the person had left before checking out. */
  suggestedMinutes: number;
};

/**
 * What the location trail says about the overtime: when the person had
 * already left the work place before checking out (their last positions are
 * away from it), only the time up to their last position there is suggested.
 * Null when the trail says nothing (no positions after overtime started, or
 * they were still at the place at the end).
 */
export function checkAgainstTrail(input: {
  found: FoundOvertime;
  checkOut: Date;
  /** The shift's positions, any order. */
  pings: readonly Ping[];
  place: Place;
  /** Where the check-out was, when the phone gave a position. */
  checkOutAt?: { lat: number; lng: number; accuracy?: number | null } | null;
  rules: Pick<OvertimeRules, "overtimeMinMinutes">;
}): TrailCheck | null {
  const { found, place } = input;
  const at = (p: { lat: number; lng: number; accuracy?: number | null }) =>
    !checkAgainstPlaces({ ...p, accuracy: p.accuracy ?? null }, [place], place.id)!.away;
  const during = input.pings
    .filter((p) => p.at >= found.startsAt && p.at <= input.checkOut)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const endPoints = [
    ...during.map((p) => ({ when: p.at, here: at(p) })),
    ...(input.checkOutAt ? [{ when: input.checkOut, here: at(input.checkOutAt) }] : []),
  ];
  if (endPoints.length === 0) return null;
  // Still at the place at the end: the trail backs the overtime as found.
  if (endPoints.at(-1)!.here) return null;
  const lastHere = [...endPoints].reverse().find((p) => p.here)?.when ?? null;
  const stayed = lastHere ? (lastHere.getTime() - found.startsAt.getTime()) / 60_000 : 0;
  const suggested =
    stayed >= Math.max(input.rules.overtimeMinMinutes, 1) ? roundOvertime(stayed) : 0;
  if (suggested >= found.minutes) return null;
  return { lastAtPlace: lastHere, suggestedMinutes: suggested };
}
