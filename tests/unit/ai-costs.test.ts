import { describe, expect, it } from "vitest";

import { costsHref } from "@/components/ai/costs-screen";
import { budgetSchema, costQuerySchema, periodDays } from "@/modules/ai/costs.service";
import { costUsd } from "@/modules/ai/models";
import { estimateInputTokens, periodStarts } from "@/modules/ai/usage.service";
import { AppError } from "@/lib/errors";

/* AI cost tracking, the parts without a database: periods, prices, estimates and the form. */

const days = (raw: unknown, today = "2026-10-14") => periodDays(costQuerySchema.parse(raw), today);

describe("AI cost periods", () => {
  it("covers today, the last 7 and 30 days, this month and a chosen range", () => {
    expect(days({ period: "today" })).toEqual({ from: "2026-10-14", to: "2026-10-14" });
    expect(days({ period: "7d" })).toEqual({ from: "2026-10-08", to: "2026-10-14" });
    expect(days({ period: "30d" })).toEqual({ from: "2026-09-15", to: "2026-10-14" });
    expect(days({})).toEqual({ from: "2026-10-01", to: "2026-10-14" });
    expect(days({ period: "custom", from: "2026-01-01", to: "2026-03-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    // A range without its ends starts at the month and ends today.
    expect(days({ period: "custom" })).toEqual({ from: "2026-10-01", to: "2026-10-14" });
    expect(() => days({ period: "custom", from: "2026-03-01", to: "2026-02-01" })).toThrow(
      AppError,
    );
    expect(() => days({ period: "custom", from: "2025-01-01", to: "2026-10-01" })).toThrow(
      /a year or less/,
    );
    expect(() => costQuerySchema.parse({ period: "custom", from: "14/10/2026" })).toThrow();
  });

  it("starts the month and the day in company time", () => {
    // 20:00 UTC on 31 October is already 1 November in Dhaka.
    const starts = periodStarts(new Date("2026-10-31T20:00:00Z"), "Asia/Dhaka");
    expect(starts.month).toBe("2026-11");
    expect(starts.monthStart.toISOString()).toBe("2026-10-31T18:00:00.000Z");
    expect(starts.dayStart.toISOString()).toBe("2026-10-31T18:00:00.000Z");
  });

  it("links the screen's periods and person", () => {
    expect(costsHref({ period: "month" })).toBe("/ai/costs");
    expect(costsHref({ period: "7d" })).toBe("/ai/costs?period=7d");
    expect(
      costsHref({ period: "custom", from: "2026-10-01", to: "2026-10-05", userId: "u1" }),
    ).toBe("/ai/costs?period=custom&from=2026-10-01&to=2026-10-05&person=u1");
    // One day, one breakdown row and a page of its calls.
    expect(costsHref({ period: "day", from: "2026-10-03", to: "2026-10-03" })).toBe(
      "/ai/costs?period=day&from=2026-10-03",
    );
    expect(costsHref({ period: "yesterday", from: "2026-10-03" })).toBe(
      "/ai/costs?period=yesterday",
    );
    expect(costsHref({ period: "today", by: "place", key: "/ai/chat", page: 2 })).toBe(
      "/ai/costs?period=today&by=place&key=%2Fai%2Fchat&page=2",
    );
    expect(costsHref({ period: "today", by: "place", key: null, page: 1 })).toBe(
      "/ai/costs?period=today",
    );
  });
});

describe("AI cost sums", () => {
  it("prices a call by its tokens, cache reads and writes included", () => {
    expect(costUsd("claude-opus-5-5", { input: 1_000_000, output: 0 })).toBe(4);
    expect(costUsd("claude-sonnet-5-5", { input: 0, output: 1_000_000 })).toBe(10);
    expect(costUsd("claude-sonnet-5-5", { input: 0, output: 0, cacheRead: 1_000_000 })).toBe(0.2);
    expect(costUsd("claude-haiku-5-5", { input: 0, output: 0, cacheWrite: 10_000 })).toBeCloseTo(
      0.00125,
      10,
    );
    // Haiku costs more above 100K prompt tokens.
    expect(costUsd("claude-haiku-5-5", { input: 0, output: 0, cacheWrite: 1_000_000 })).toBe(0.625);
    expect(costUsd("not-a-model", { input: 5, output: 5 })).toBe(0);
  });

  it("estimates a request's input from its text, pictures and files", () => {
    expect(estimateInputTokens({ maxTokens: 10, messages: [{ content: "x".repeat(35) }] })).toBe(
      10,
    );
    expect(
      estimateInputTokens({
        system: "y".repeat(7),
        maxTokens: 10,
        messages: [
          {
            content: [
              { type: "text", text: "z".repeat(7) },
              { type: "image", source: {} },
              { type: "document", source: {} },
            ],
          },
        ],
      }),
    ).toBe(4 + 3_200);
  });

  it("reads the budget form: empty is no limit, commas are allowed, the rest is checked", () => {
    const parsed = budgetSchema.parse({
      monthly: "5,000",
      daily: "",
      perOrder: 250.5,
      alertPercent: "80",
      atLimit: "CHEAPER",
      usdRate: "121.75",
    });
    expect(parsed).toMatchObject({
      monthly: "5000",
      daily: null,
      perOrder: "250.5",
      alertPercent: 80,
      atLimit: "CHEAPER",
      usdRate: "121.75",
    });
    const bad = (input: Record<string, unknown>) =>
      budgetSchema.safeParse({ alertPercent: 80, atLimit: "STOP", usdRate: "122", ...input })
        .success;
    expect(bad({ monthly: "-5" })).toBe(false);
    expect(bad({ monthly: "1.234" })).toBe(false);
    expect(bad({ alertPercent: 101 })).toBe(false);
    expect(bad({ atLimit: "MAYBE" })).toBe(false);
    expect(bad({ usdRate: "0" })).toBe(false);
    expect(bad({})).toBe(true);
  });
});
