import { describe, expect, it } from "vitest";

import { lossText, partText, pointsText, scoreText } from "@/components/hr/score-labels";
import {
  performanceScore,
  type ScoreClaim,
  type ScoreDay,
  type ScoreTask,
  scoreTone,
} from "@/modules/hr/score";
import { nextAnniversary, tenureOn, tenureText } from "@/modules/hr/tenure";

/*
 * The employee dashboard's pure rules: the performance score (attendance half,
 * tasks on time 30%, clean claims 20%, a part with nothing to count left out)
 * with every point lost accounted for, and the tenure clock's calendar maths.
 */

const day = (date: string, status: ScoreDay["status"], halfLeave = false): ScoreDay => ({
  date,
  status,
  halfLeave,
});
const task = (dueDay: string, doneDay: string | null, title = `Task due ${dueDay}`): ScoreTask => ({
  id: `t-${dueDay}-${doneDay}`,
  title,
  dueDay,
  doneDay,
});
const claim = (number: string, approved: boolean, cut = false): ScoreClaim => ({
  id: number,
  number,
  date: "2026-10-05",
  approved,
  cut,
});
const window = { from: "2026-09-13", to: "2026-10-12" };
const lost = (s: ReturnType<typeof performanceScore>) =>
  s.losses.reduce((sum, l) => sum + l.points, 0);

describe("the performance score", () => {
  it("is 10 and green when every day, task and claim counts in full", () => {
    const s = performanceScore({
      ...window,
      days: [day("2026-10-05", "PRESENT"), day("2026-10-06", "PRESENT")],
      tasks: [task("2026-10-06", "2026-10-06"), task("2026-10-20", "2026-10-10")],
      claims: [claim("CLM-1", true)],
    });
    expect(s.score).toBe(10);
    expect(s.tone).toBe("good");
    expect(s.losses).toEqual([]);
    expect(s.parts.map((p) => [p.part, p.percent, p.weight])).toEqual([
      ["attendance", 100, 5],
      ["tasks", 100, 3],
      ["claims", 100, 2],
    ]);
  });

  it("weighs attendance half, tasks 30% and claims 20%, and says what lost each point", () => {
    const s = performanceScore({
      ...window,
      days: [
        day("2026-10-05", "PRESENT"),
        day("2026-10-06", "LATE"),
        day("2026-10-07", "ABSENT"),
        day("2026-10-08", "HALF_DAY"),
      ],
      tasks: [
        task("2026-10-06", "2026-10-06"),
        task("2026-10-07", "2026-10-09", "Cut the samples"),
        task("2026-10-08", null, "Visit Gazipur"),
        task("2026-10-20", "2026-10-10"),
      ],
      claims: [claim("CLM-1", true), claim("CLM-2", true, true), claim("CLM-3", false)],
    });
    // 5 × 0.5 + 3 × 0.625 + 2 × 0.5 = 5.375
    expect(s.score).toBe(5.4);
    expect(s.tone).toBe("fair");
    expect(s.parts.map((p) => p.percent)).toEqual([50, 63, 50]);
    expect(s.parts[0]!.counts).toEqual({ counted: 4, full: 1, half: 2, none: 1 });
    expect(s.parts[1]!.counts).toEqual({ counted: 4, full: 2, half: 1, none: 1 });
    expect(lost(s)).toBeCloseTo(10 - 5.375, 1);
    // Newest first, the biggest loss first on the same day.
    expect(s.losses.map((l) => [l.kind, l.day, l.points])).toEqual([
      ["TASK_LATE", "2026-10-09", 0.38],
      ["TASK_OVERDUE", "2026-10-08", 0.75],
      ["HALF_DAY", "2026-10-08", 0.63],
      ["ABSENT", "2026-10-07", 1.25],
      ["LATE", "2026-10-06", 0.63],
      ["CLAIM_REJECTED", "2026-10-05", 0.67],
      ["CLAIM_CUT", "2026-10-05", 0.33],
    ]);
    expect(s.losses.map(lossText)).toEqual([
      "“Cut the samples” done 2 days late",
      "“Visit Gazipur” not done, due 8 Oct 2026",
      "Half day on 8 Oct 2026",
      "Absent on 7 Oct 2026",
      "Late on 6 Oct 2026",
      "Claim CLM-3 not approved",
      "Claim CLM-2 approved for less",
    ]);
  });

  it("leaves out a part with nothing to count, and the others share its points", () => {
    const s = performanceScore({
      ...window,
      days: [day("2026-10-05", "PRESENT"), day("2026-10-06", "ABSENT")],
      tasks: [task("2026-10-06", "2026-10-06")],
      claims: [],
    });
    expect(s.parts.map((p) => [p.percent, p.weight])).toEqual([
      [50, 6.25],
      [100, 3.75],
      [null, 0],
    ]);
    // 6.25 × 0.5 + 3.75 × 1
    expect(s.score).toBe(6.9);
    expect(s.losses).toEqual([
      { part: "attendance", kind: "ABSENT", day: "2026-10-06", points: 3.13 },
    ]);
  });

  it("counts a half day as full when the other half is approved leave", () => {
    const s = performanceScore({
      ...window,
      days: [day("2026-10-05", "HALF_DAY", true)],
      tasks: [],
      claims: [],
    });
    expect(s.score).toBe(10);
  });

  it("has no score while there is nothing to count", () => {
    const s = performanceScore({ ...window, days: [], tasks: [], claims: [] });
    expect(s.score).toBeNull();
    expect(s.tone).toBe("none");
    expect(s.parts.every((p) => p.percent === null && p.weight === 0)).toBe(true);
  });

  it("is green from 8, yellow from 5 and red below", () => {
    expect([10, 8, 7.9, 5, 4.9, 0, null].map(scoreTone)).toEqual([
      "good",
      "good",
      "fair",
      "fair",
      "poor",
      "poor",
      "none",
    ]);
  });

  it("explains each part and each loss in words", () => {
    const s = performanceScore({
      ...window,
      days: [day("2026-10-05", "PRESENT"), day("2026-10-06", "LATE")],
      tasks: [],
      claims: [claim("CLM-9", true, true)],
    });
    expect(s.parts.map(partText)).toEqual([
      "1 on time and 1 late or half day, of 2 working days.",
      "No tasks were due.",
      "1 approved for less, of 1 claim.",
    ]);
    expect(pointsText(0.5)).toBe("−0.50");
    expect([scoreText(10), scoreText(8.4), scoreText(5)]).toEqual(["10", "8.4", "5"]);
  });
});

describe("the tenure clock", () => {
  it("counts whole years, months and days as a calendar does", () => {
    expect(tenureOn("2025-01-01", "2026-10-12")).toEqual({
      years: 1,
      months: 9,
      days: 11,
      totalDays: 649,
    });
    // From the 31st, a short month ends the month early.
    expect(tenureOn("2024-01-31", "2024-03-01")).toMatchObject({ years: 0, months: 1, days: 1 });
    expect(tenureOn("2024-01-15", "2024-03-14")).toMatchObject({ months: 1, days: 28 });
    expect(tenureOn("2026-10-12", "2026-10-12")).toMatchObject({ years: 0, months: 0, days: 0 });
    expect(tenureOn("2026-11-01", "2026-10-12").totalDays).toBe(0);
  });

  it("writes the time out in words", () => {
    expect(tenureText(tenureOn("2024-07-01", "2026-10-13"))).toBe("2 years, 3 months and 12 days");
    expect(tenureText(tenureOn("2025-10-12", "2026-10-12"))).toBe("1 year");
    expect(tenureText(tenureOn("2026-10-07", "2026-10-12"))).toBe("5 days");
    expect(tenureText(tenureOn("2026-10-12", "2026-10-12"))).toBe("Joined today");
  });

  it("finds the next work anniversary", () => {
    expect(nextAnniversary("2025-01-01", "2026-10-12")).toEqual({
      date: "2027-01-01",
      years: 2,
      inDays: 81,
    });
    // On the day itself, the next one is a year away.
    expect(nextAnniversary("2024-10-12", "2026-10-12").date).toBe("2027-10-12");
    // 29 February joiners count on 28 February in other years.
    expect(nextAnniversary("2024-02-29", "2024-10-12")).toMatchObject({
      date: "2025-02-28",
      years: 1,
    });
    expect(nextAnniversary("2026-11-01", "2026-10-12")).toMatchObject({
      date: "2027-11-01",
      years: 1,
    });
  });
});
