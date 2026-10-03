import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatDay,
  formatDayRange,
  formatLongDay,
  formatMonth,
  groupAmount,
  usesLakhGrouping,
} from "@/lib/display";
import { errorCodeFor, errorMessageFor, randomErrorCode } from "@/lib/error-code";
import { newErrorId } from "@/lib/errors";
import { formatAmount } from "@/lib/format";

describe("amounts and counts on screen", () => {
  it("groups Bangladeshi and Indian amounts in lakhs and crores", () => {
    expect(usesLakhGrouping("bdt")).toBe(true);
    expect(groupAmount("1234567.50", "BDT")).toBe("12,34,567.50");
    expect(groupAmount("123456789.00", "BDT")).toBe("12,34,56,789.00");
    expect(groupAmount("99999.99", "INR")).toBe("99,999.99");
    expect(groupAmount("999.00", "BDT")).toBe("999.00");
  });

  it("groups other currencies in thousands", () => {
    expect(usesLakhGrouping("USD")).toBe(false);
    expect(groupAmount("1234567.50", "USD")).toBe("1,234,567.50");
    expect(groupAmount("1000", "EUR")).toBe("1,000");
  });

  it("keeps the minus sign, except on a zero", () => {
    expect(groupAmount("-1234567.50", "BDT")).toBe("-12,34,567.50");
    expect(groupAmount("-0.00", "BDT")).toBe("0.00");
    expect(formatAmount("-1234.5", 2, "USD")).toBe("-1,234.50");
  });

  it("writes whole counts the same way as the company's money", () => {
    expect(formatCount(124500, "BDT")).toBe("1,24,500");
    expect(formatCount(124500, "USD")).toBe("124,500");
    expect(formatCount(-1500, "BDT")).toBe("-1,500");
    expect(formatCount(0, "BDT")).toBe("0");
  });
});

describe("dates on screen", () => {
  it("writes days and months the way people read them", () => {
    expect(formatDay("2026-09-01")).toBe("1 Sep 2026");
    expect(formatMonth("2026-09")).toBe("Sep 2026");
    expect(formatLongDay("2026-10-03")).toBe("Saturday, 3 October 2026");
    expect(formatLongDay("2024-02-29")).toBe("Thursday, 29 February 2024");
  });

  it("shortens a range that stays within a month or a year", () => {
    expect(formatDayRange("2026-09-01", "2026-09-30")).toBe("1 – 30 Sep 2026");
    expect(formatDayRange("2026-09-04", "2026-10-03")).toBe("4 Sep – 3 Oct 2026");
    expect(formatDayRange("2025-10-04", "2026-10-03")).toBe("4 Oct 2025 – 3 Oct 2026");
    expect(formatDayRange("2026-10-03", "2026-10-03")).toBe("3 Oct 2026");
  });
});

describe("error codes people read out to support", () => {
  it("are short, upper case and free of look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      expect(randomErrorCode()).toMatch(/^ERR-[A-HJ-NP-Z2-9]{8}$/);
      expect(newErrorId()).toMatch(/^ERR-[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it("use the server's digest for a failed screen, so the server log can be searched", () => {
    expect(errorCodeFor({ digest: "1433874395" })).toBe("ERR-1433874395");
    // Anything odd in the digest is not shown; the person still gets a code.
    expect(errorCodeFor({ digest: "<script>" })).toMatch(/^ERR-[A-Z0-9]{8}$/);
    expect(errorCodeFor({})).toMatch(/^ERR-[A-Z0-9]{8}$/);
  });

  it("are given in the blueprint's words", () => {
    expect(errorMessageFor("ERR-7F3K9Q2M")).toBe(
      "An error occurred. Error Code: ERR-7F3K9Q2M. Please share this with your technical support.",
    );
  });
});
