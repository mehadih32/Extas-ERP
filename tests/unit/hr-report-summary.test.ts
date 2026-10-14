import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import {
  attendanceRate,
  type ReportFacts,
  ruleSummary,
  summarise,
} from "@/modules/hr/report-summary";

import { fakeAsk } from "../fixtures/claude";

/*
 * The summary on top of an employee's 360° report: written by rules from the
 * figures, or worded by Claude from the same figures while the company's AI is
 * on, asked once per set of figures, and back to the rules whenever it fails.
 */

const facts: ReportFacts = {
  from: "2025-11-01",
  to: "2026-10-12",
  post: "Cutting master, Production",
  tenure: "1 year 9 months",
  attendance: { workingDays: 280, present: 268, absent: 4, leave: 6.5, late: 9 },
  overtimeHours: 42.5,
  tasks: { due: 17, onTime: 15, late: 1, overdue: 1, open: 3 },
  money: {
    currency: "BDT",
    salary: "360000.00",
    bonus: "5000.00",
    overtimePay: "0.00",
    conveyance: { amount: "1830.00", trips: 9 },
  },
};

describe("360° report summary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("writes the summary from the figures alone", () => {
    expect(attendanceRate(facts.attendance)).toBe("96%");
    expect(ruleSummary(facts)).toBe(
      "Present on 268 of 280 working days (96%) from 1 Nov 2025 to 12 Oct 2026, with 4 days absent, 6.5 days on leave, 9 late arrivals. " +
        "Worked 42.5 hours of approved overtime. " +
        "Finished 16 of 17 tasks due, 15 on time; 1 overdue. 2 more tasks are still open. " +
        "Paid BDT 3,60,000.00 in salary, BDT 5,000.00 in bonuses on approved payrolls. " +
        "Claimed BDT 1,830.00 of conveyance over 9 trips.",
    );
    // Without money (a reader who sees no salaries) or anything to say about tasks.
    expect(
      ruleSummary({
        ...facts,
        attendance: { workingDays: 20, present: 20, absent: 0, leave: 0, late: 0 },
        overtimeHours: 0,
        tasks: { due: 0, onTime: 0, late: 0, overdue: 0, open: 0 },
        money: { currency: "BDT" },
      }),
    ).toBe("Present on 20 of 20 working days (100%) from 1 Nov 2025 to 12 Oct 2026.");
    // Tasks given, none due yet.
    expect(
      ruleSummary({
        ...facts,
        tasks: { due: 0, onTime: 0, late: 0, overdue: 0, open: 1 },
        money: { currency: "BDT" },
      }),
    ).toMatch(/approved overtime\. 1 task is still open\.$/);
  });

  it("uses the rules while the company's AI is off", async () => {
    expect(await summarise(facts, null)).toEqual({ text: ruleSummary(facts), by: "rules" });
    expect(await summarise(facts)).toEqual({ text: ruleSummary(facts), by: "rules" });
  });

  it("asks the AI with the figures only, briefly, and once per set of figures", async () => {
    const { ask, asked } = fakeAsk("  The employee was present on 96% of days.\n");
    const first = await summarise(facts, ask);
    expect(first).toEqual({ text: "The employee was present on 96% of days.", by: "ai" });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(asked[0]).toMatchObject({ task: "text.write", effort: "low" });
    expect(JSON.parse(String(asked[0]!.messages[0]!.content))).toEqual(facts);
    // Short instructions and the figures: a few hundred tokens at most.
    expect(
      String(asked[0]!.system).length + String(asked[0]!.messages[0]!.content).length,
    ).toBeLessThan(1500);

    // The same figures again: no second request.
    expect(await summarise({ ...facts }, ask)).toEqual(first);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("falls back to the rules when the AI fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const changed = { ...facts, overtimeHours: 1 };
    const busy = fakeAsk(new AppError("UNAVAILABLE", "The AI is busy. Try again in a minute."));
    expect(await summarise(changed, busy.ask)).toEqual({
      text: ruleSummary(changed),
      by: "rules",
    });
    const empty = fakeAsk("   ");
    expect((await summarise(changed, empty.ask)).by).toBe("rules");
  });
});
