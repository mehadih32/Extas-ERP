import { describe, expect, it } from "vitest";

import { complianceStatus } from "@/modules/compliance/status";
import {
  describeRepeat,
  formatRepeat,
  nextOccurrence,
  parseRepeat,
  type Repeat,
} from "@/modules/reminders/repeat";
import { complianceSteps, DEFAULT_RULES, dueStep } from "@/modules/reminders/rules";
import { type DueItem, relativeDays, reminderText } from "@/modules/reminders/sources";

const TZ = "Asia/Dhaka"; // UTC+6, no daylight saving

/** A Dhaka wall-clock time as an instant. */
const dhaka = (day: string, time = "09:00") => new Date(`${day}T${time}:00+06:00`);

const repeat = (r: Partial<Repeat> & Pick<Repeat, "every">): Repeat => ({
  interval: 1,
  until: null,
  monthDay: null,
  ...r,
});

describe("repeating reminders", () => {
  it("stores the rule as an RRULE subset and reads it back", () => {
    const r = repeat({ every: "MONTH", interval: 2, monthDay: 31, until: "2027-06-30" });
    expect(formatRepeat(r)).toBe("FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=31;UNTIL=20270630");
    expect(parseRepeat(formatRepeat(r))).toEqual(r);
    expect(parseRepeat("FREQ=WEEKLY;INTERVAL=1")).toEqual(repeat({ every: "WEEK" }));
    expect(parseRepeat(null)).toBeNull();
    expect(parseRepeat("FREQ=HOURLY")).toBeNull();
    expect(parseRepeat("FREQ=DAILY;INTERVAL=0")).toBeNull();
    expect(parseRepeat("FREQ=MONTHLY;BYMONTHDAY=40")).toBeNull();
  });

  it("describes the rule in words", () => {
    expect(describeRepeat(repeat({ every: "DAY" }))).toBe("Every day");
    expect(describeRepeat(repeat({ every: "WEEK", interval: 2 }))).toBe("Every 2 weeks");
    expect(describeRepeat(repeat({ every: "MONTH", monthDay: 15 }))).toBe("Every month on day 15");
    expect(describeRepeat(repeat({ every: "YEAR", until: "2027-12-31" }))).toBe(
      "Every year until 31 Dec 2027",
    );
  });

  it("keeps the wall-clock time and steps by the interval", () => {
    const at = dhaka("2026-10-05", "10:30");
    expect(nextOccurrence(at, repeat({ every: "DAY", interval: 2 }), TZ, at)).toEqual(
      dhaka("2026-10-07", "10:30"),
    );
    expect(nextOccurrence(at, repeat({ every: "WEEK" }), TZ, at)).toEqual(
      dhaka("2026-10-12", "10:30"),
    );
  });

  it("falls on the last day of shorter months and goes back to the 31st after", () => {
    const r = repeat({ every: "MONTH", monthDay: 31 });
    const jan = dhaka("2026-01-31");
    const feb = nextOccurrence(jan, r, TZ, jan)!;
    expect(feb).toEqual(dhaka("2026-02-28"));
    const mar = nextOccurrence(feb, r, TZ, feb)!;
    expect(mar).toEqual(dhaka("2026-03-31"));
    expect(nextOccurrence(mar, r, TZ, mar)).toEqual(dhaka("2026-04-30"));
  });

  it("puts a 29 February reminder on 28 February in other years", () => {
    const r = repeat({ every: "YEAR", monthDay: 29 });
    const leap = dhaka("2028-02-29");
    expect(nextOccurrence(leap, r, TZ, leap)).toEqual(dhaka("2029-02-28"));
  });

  it("fires once after a long gap instead of once per missed day", () => {
    const daily = repeat({ every: "DAY" });
    const due = dhaka("2026-10-01");
    // The server was off for ten days; it is now 10 Oct 10:00.
    expect(nextOccurrence(due, daily, TZ, dhaka("2026-10-10", "10:00"))).toEqual(
      dhaka("2026-10-11"),
    );
    // Weekly on Thursdays stays on Thursdays.
    const weekly = repeat({ every: "WEEK" });
    const next = nextOccurrence(dhaka("2026-10-01"), weekly, TZ, dhaka("2026-11-20", "12:00"))!;
    expect(next).toEqual(dhaka("2026-11-26"));
    expect(next.getUTCDay()).toBe(dhaka("2026-10-01").getUTCDay());
  });

  it("stops after the last day", () => {
    const r = repeat({ every: "WEEK", until: "2026-10-10" });
    const at = dhaka("2026-10-05");
    expect(nextOccurrence(at, r, TZ, at)).toBeNull();
    expect(nextOccurrence(at, repeat({ every: "DAY", until: "2026-10-06" }), TZ, at)).toEqual(
      dhaka("2026-10-06"),
    );
  });
});

describe("automatic reminder steps", () => {
  const days = [7, 3, 1, 0];

  it("fires the step reached before the date, once", () => {
    expect(dueStep(10, days, 3)).toBeNull();
    expect(dueStep(7, days, 3)).toEqual({ key: "d7", offset: 7 });
    // Still the week-before step until three days before (it is only sent once).
    expect(dueStep(5, days, 3)).toEqual({ key: "d7", offset: 7 });
    expect(dueStep(3, days, 3)).toEqual({ key: "d3", offset: 3 });
    expect(dueStep(2, days, 3)).toEqual({ key: "d3", offset: 3 });
    expect(dueStep(1, days, 3)).toEqual({ key: "d1", offset: 1 });
    expect(dueStep(0, days, 3)).toEqual({ key: "d0", offset: 0 });
  });

  it("repeats every few days once the date has passed", () => {
    expect(dueStep(-1, days, 3)).toEqual({ key: "late0", offset: -1 });
    expect(dueStep(-3, days, 3)).toEqual({ key: "late0", offset: -1 });
    expect(dueStep(-4, days, 3)).toEqual({ key: "late1", offset: -4 });
    expect(dueStep(-7, days, 3)).toEqual({ key: "late2", offset: -7 });
    expect(dueStep(-2, days, 1)).toEqual({ key: "late1", offset: -2 });
    expect(dueStep(-5, days, 0)).toBeNull();
  });

  it("starts a licence's alerts at its own renewal window", () => {
    const rule = DEFAULT_RULES.COMPLIANCE_EXPIRY.daysBefore;
    expect(complianceSteps(rule, 30)).toEqual([30, 15, 7, 1, 0]);
    expect(complianceSteps(rule, 10)).toEqual([10, 7, 1, 0]);
    expect(complianceSteps(rule, 15)).toEqual([15, 7, 1, 0]);
    expect(complianceSteps(rule, 0)).toEqual([0]);
  });
});

describe("licence status", () => {
  const doc = (expiryDate: string | null, extra: object = {}) => ({
    expiryDate,
    alertDaysBefore: 30,
    ...extra,
  });

  it("is valid, expiring inside the renewal window, then expired", () => {
    expect(complianceStatus(doc("2026-12-31"), "2026-10-01")).toEqual({
      status: "VALID",
      daysLeft: 91,
    });
    expect(complianceStatus(doc("2026-10-31"), "2026-10-01")).toEqual({
      status: "EXPIRING",
      daysLeft: 30,
    });
    expect(complianceStatus(doc("2026-10-01"), "2026-10-01")).toEqual({
      status: "EXPIRING",
      daysLeft: 0,
    });
    expect(complianceStatus(doc("2026-09-30"), "2026-10-01")).toEqual({
      status: "EXPIRED",
      daysLeft: -1,
    });
    expect(complianceStatus(doc(null), "2026-10-01")).toEqual({
      status: "NO_EXPIRY",
      daysLeft: null,
    });
  });

  it("marks renewed and archived records as history", () => {
    const when = new Date();
    expect(complianceStatus(doc("2026-09-30", { supersededAt: when }), "2026-10-01").status).toBe(
      "SUPERSEDED",
    );
    expect(complianceStatus(doc("2026-12-31", { archivedAt: when }), "2026-10-01").status).toBe(
      "ARCHIVED",
    );
  });
});

describe("reminder wording", () => {
  const item = (type: DueItem["type"], extra: Partial<DueItem> = {}): DueItem => ({
    type,
    recordId: "r1",
    dueDay: "2026-10-12",
    dueTime: null,
    title: "PRJ-0007 Polo shirts",
    detail: "Rahim Traders · Sewing",
    ownerUserIds: [],
    ownerEmployeeIds: [],
    alertDaysBefore: null,
    link: { type: "ProductionProject", id: "r1" },
    refs: { projectId: "r1" },
    ...extra,
  });

  it("says what, when and how far off", () => {
    expect(relativeDays(0)).toBe("today");
    expect(relativeDays(1)).toBe("tomorrow");
    expect(relativeDays(7)).toBe("in 7 days");
    expect(relativeDays(-1)).toBe("1 day ago");
    expect(relativeDays(-4)).toBe("4 days ago");
    expect(reminderText(item("PRODUCTION_DEADLINE"), 7)).toEqual({
      subject: "Production deadline: PRJ-0007 Polo shirts",
      body: "Target date 12 Oct 2026 (in 7 days). Rahim Traders · Sewing",
    });
    expect(reminderText(item("TASK_DUE", { dueTime: "10:30", detail: "" }), -2)).toEqual({
      subject: "Task due: PRJ-0007 Polo shirts",
      body: "Due 12 Oct 2026 10:30 (overdue, 2 days ago).",
    });
  });

  it("calls a licence that ran out expired", () => {
    const licence = item("COMPLIANCE_EXPIRY", { title: "Trade licence TRAD/DNCC/123" });
    expect(reminderText(licence, 15).subject).toBe("Renewal due: Trade licence TRAD/DNCC/123");
    expect(reminderText(licence, -3)).toEqual({
      subject: "Licence expired: Trade licence TRAD/DNCC/123",
      body: "Expired 12 Oct 2026 (3 days ago). Rahim Traders · Sewing",
    });
  });
});
