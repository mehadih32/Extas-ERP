import { describe, expect, it } from "vitest";

import {
  checkAgainstTrail,
  findOvertime,
  readHours,
  roundOvertime,
  shiftEndOn,
} from "@/modules/hr/overtime";

const TZ = "Asia/Dhaka"; // UTC+6, no summer time
const RULES = { officeStartTime: "09:00", officeEndTime: "18:00", overtimeMinMinutes: 30 };
/** A Dhaka wall-clock time on 5 Oct 2026 (a Monday), or the day after. */
const at = (time: string, day = "2026-10-05") => new Date(`${day}T${time}:00+06:00`);
const OFFICE = { id: "ho", name: "Head office", lat: 23.7806, lng: 90.407, radiusMeters: 150 };
const north = (metres: number) => ({ lat: OFFICE.lat + metres / 111_195, lng: OFFICE.lng });

describe("shadow overtime: finding it", () => {
  it("counts in whole 15-minute steps", () => {
    expect(roundOvertime(0)).toBe(0);
    expect(roundOvertime(14)).toBe(0);
    expect(roundOvertime(74)).toBe(60);
    expect(roundOvertime(76)).toBe(75);
    expect(roundOvertime(-20)).toBe(0);
  });

  it("ends a night shift the next morning", () => {
    expect(shiftEndOn("2026-10-05", RULES, TZ)).toEqual(at("18:00"));
    const night = { ...RULES, officeStartTime: "20:00", officeEndTime: "05:00" };
    expect(shiftEndOn("2026-10-05", night, TZ)).toEqual(at("05:00", "2026-10-06"));
  });

  it("counts from the end of the working day, once someone stays long enough", () => {
    const base = { day: "2026-10-05", dayType: "WORKING" as const, rules: RULES, timeZone: TZ };
    const late = findOvertime({ ...base, checkIn: at("09:00"), checkOut: at("20:40") });
    expect(late).toEqual({ basis: "AFTER_HOURS", startsAt: at("18:00"), minutes: 150 });
    // 25 minutes after the end is under the 30-minute minimum.
    expect(findOvertime({ ...base, checkIn: at("09:00"), checkOut: at("18:25") })).toBeNull();
    expect(findOvertime({ ...base, checkIn: at("09:00"), checkOut: at("17:00") })).toBeNull();
    // Checking in after the end of the day counts from the check-in.
    const evening = findOvertime({ ...base, checkIn: at("19:00"), checkOut: at("21:00") });
    expect(evening).toMatchObject({ startsAt: at("19:00"), minutes: 120 });
    // Past midnight still counts, up to 16 hours.
    const night = findOvertime({
      ...base,
      checkIn: at("09:00"),
      checkOut: at("01:10", "2026-10-06"),
    });
    expect(night?.minutes).toBe(7 * 60);
  });

  it("counts all of a day off", () => {
    const off = findOvertime({
      day: "2026-10-09",
      dayType: "WEEKLY_OFF",
      checkIn: at("10:00", "2026-10-09"),
      checkOut: at("14:20", "2026-10-09"),
      rules: RULES,
      timeZone: TZ,
    });
    expect(off).toEqual({ basis: "DAY_OFF", startsAt: at("10:00", "2026-10-09"), minutes: 255 });
  });

  it("reads the hours HR types", () => {
    expect(readHours("1.5")).toBe(90);
    expect(readHours("1:30")).toBe(90);
    expect(readHours(" 2h ")).toBe(120);
    expect(readHours("45m")).toBe(45);
    expect(readHours("0")).toBeNull();
    expect(readHours("17")).toBeNull();
    expect(readHours("abc")).toBeNull();
    expect(readHours("1:75")).toBeNull();
  });
});

describe("shadow overtime: the location trail", () => {
  const found = { basis: "AFTER_HOURS" as const, startsAt: at("18:00"), minutes: 240 };
  const checkOut = at("22:00");
  const base = { found, checkOut, place: OFFICE, rules: RULES };

  it("backs the overtime when the person was still at the place at the end", () => {
    const pings = [
      { at: at("19:00"), ...north(20) },
      { at: at("21:55"), ...north(40) },
    ];
    expect(checkAgainstTrail({ ...base, pings })).toBeNull();
    expect(checkAgainstTrail({ ...base, pings: [] })).toBeNull();
  });

  it("suggests overtime up to the last position at the place when they left before checking out", () => {
    const pings = [
      { at: at("18:30"), ...north(20) },
      { at: at("19:20"), ...north(60) },
      { at: at("19:40"), ...north(3000) },
      { at: at("21:00"), ...north(9000) },
    ];
    const check = checkAgainstTrail({
      ...base,
      pings,
      checkOutAt: { ...north(9000), accuracy: 15 },
    });
    expect(check).toEqual({ lastAtPlace: at("19:20"), suggestedMinutes: 75 });
  });

  it("suggests nothing when they were gone before overtime started counting", () => {
    const pings = [{ at: at("18:10"), ...north(5000) }];
    expect(checkAgainstTrail({ ...base, pings })).toEqual({
      lastAtPlace: null,
      suggestedMinutes: 0,
    });
  });
});
