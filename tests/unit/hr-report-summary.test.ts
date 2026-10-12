import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiSummaryOn,
  attendanceRate,
  type ReportFacts,
  ruleSummary,
  summarise,
} from "@/modules/hr/report-summary";

/*
 * The summary on top of an employee's 360° report: written by rules from the
 * figures, or worded by the Claude API from the same figures when a key is set,
 * asked once per set of figures, and back to the rules whenever the API fails.
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

const reply = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

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

  it("uses the rules until an AI key and model are set", async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("AI_INTAKE_MODEL", "");
    vi.stubEnv("AI_SUMMARY_MODEL", "");
    const fetchImpl = vi.fn();
    expect(aiSummaryOn()).toBe(false);
    expect(await summarise(facts, { fetchImpl })).toEqual({
      text: ruleSummary(facts),
      by: "rules",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.stubEnv("AI_API_KEY", "key");
    vi.stubEnv("AI_INTAKE_MODEL", "intake-model");
    expect(aiSummaryOn()).toBe(true);
  });

  it("asks the AI with the figures only, briefly, and once per set of figures", async () => {
    vi.stubEnv("AI_API_KEY", "secret");
    vi.stubEnv("AI_INTAKE_MODEL", "intake-model");
    vi.stubEnv("AI_SUMMARY_MODEL", "summary-model");
    const fetchImpl = vi.fn(async () => reply("  The employee was present on 96% of days.\n"));
    const first = await summarise(facts, { fetchImpl });
    expect(first).toEqual({ text: "The employee was present on 96% of days.", by: "ai" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "summary-model", max_tokens: 200 });
    expect(JSON.parse(body.messages[0].content)).toEqual(facts);
    // Short instructions and the figures: a few hundred tokens at most.
    expect(String(init.body).length).toBeLessThan(1500);

    // The same figures again: no second request.
    expect(await summarise({ ...facts }, { fetchImpl })).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the rules when the AI fails", async () => {
    vi.stubEnv("AI_API_KEY", "secret");
    vi.stubEnv("AI_SUMMARY_MODEL", "summary-model");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const changed = { ...facts, overtimeHours: 1 };
    const busy = vi.fn(async () => new Response("overloaded", { status: 529 }));
    expect(await summarise(changed, { fetchImpl: busy })).toEqual({
      text: ruleSummary(changed),
      by: "rules",
    });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await summarise(changed, { fetchImpl: down })).by).toBe("rules");
    const empty = vi.fn(async () => reply("   "));
    expect((await summarise(changed, { fetchImpl: empty })).by).toBe("rules");
  });
});
