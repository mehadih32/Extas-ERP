import { describe, expect, it } from "vitest";

import { dayRange, nextDay, startOfDayInZone } from "@/lib/dates";

describe("company-time day boundaries", () => {
  it("starts a Dhaka day at 18:00 UTC the evening before", () => {
    expect(startOfDayInZone("2026-03-01", "Asia/Dhaka").toISOString()).toBe(
      "2026-02-28T18:00:00.000Z",
    );
    expect(startOfDayInZone("2026-03-01", "UTC").toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("handles daylight saving time zones", () => {
    // London is on summer time (UTC+1) in July.
    expect(startOfDayInZone("2026-07-10", "Europe/London").toISOString()).toBe(
      "2026-07-09T23:00:00.000Z",
    );
  });

  it("rolls over month and year ends", () => {
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("makes a plain 'to' day inclusive and keeps timestamps exact", () => {
    const { start, end } = dayRange("2026-02-01", "2026-02-28", "Asia/Dhaka");
    expect(start?.toISOString()).toBe("2026-01-31T18:00:00.000Z");
    expect(end?.toISOString()).toBe("2026-02-28T18:00:00.000Z");
    const exact = dayRange(undefined, "2026-02-28T10:00:00Z", "Asia/Dhaka");
    expect(exact.start).toBeUndefined();
    expect(exact.end?.toISOString()).toBe("2026-02-28T10:00:00.001Z");
  });
});
