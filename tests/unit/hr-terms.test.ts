import { describe, expect, it } from "vitest";

import { safeNextPath, termsPath } from "@/lib/routes";
import {
  maskedPhone,
  paragraphsOf,
  sectionsOf,
  STARTER_TERMS,
  TERMS_LIMITS,
  termsDue,
  tidyTerms,
} from "@/modules/hr/terms";
import { termsDraftSchema } from "@/modules/hr/schemas";
import { retryDelayMs } from "@/modules/jobs/queue";

describe("the terms text", () => {
  it("splits text into paragraphs at blank lines, tidying spaces", () => {
    expect(paragraphsOf("One  line.\r\n\r\n\n  Two\tlines\nhere.  \n \n")).toEqual([
      "One line.",
      "Two lines\nhere.",
    ]);
    expect(paragraphsOf("")).toEqual([]);
    expect(paragraphsOf(null)).toEqual([]);
  });

  it("stores the text tidy, with no empty opening note", () => {
    expect(
      tidyTerms({
        title: "  Terms ",
        intro: " \n\n ",
        sections: [{ title: " A ", body: "x\n\n\n\ny" }],
      }),
    ).toEqual({ title: "Terms", intro: null, sections: [{ title: "A", body: "x\n\ny" }] });
  });

  it("reads stored sections back, leaving out anything else", () => {
    expect(sectionsOf([{ title: "A", body: "a" }, { title: 1 }, null, "x"])).toEqual([
      { title: "A", body: "a" },
    ]);
    expect(sectionsOf({ title: "A", body: "a" })).toEqual([]);
  });

  it("starts HR off with text that passes the draft checks", () => {
    const parsed = termsDraftSchema.parse(STARTER_TERMS);
    expect(parsed.sections).toHaveLength(4);
    expect(STARTER_TERMS.sections.length).toBeLessThanOrEqual(TERMS_LIMITS.sections);
    // Bengali first, with the English alongside.
    for (const s of STARTER_TERMS.sections) expect(s.title).toMatch(/[ঀ-৿].*\(.+\)$/);
  });
});

describe("who must agree", () => {
  const since = new Date("2026-10-12T09:00:00Z");

  it("asks nobody until terms are published", () => {
    expect(termsDue(null, null)).toBe(false);
    expect(termsDue(null, since)).toBe(false);
  });

  it("asks people who never agreed or agreed before the version everyone must agree to", () => {
    expect(termsDue(since, null)).toBe(true);
    expect(termsDue(since, new Date("2026-10-12T08:59:59Z"))).toBe(true);
    expect(termsDue(since, since)).toBe(false);
    expect(termsDue(since, new Date("2026-10-13T00:00:00Z"))).toBe(false);
  });

  it("shows enough of a phone number to recognise it", () => {
    expect(maskedPhone("01711000123")).toBe("01711-•••123");
  });
});

describe("the terms screen address", () => {
  it("brings people back to the page they asked for, never to the terms again", () => {
    expect(termsPath("/sales?tab=open")).toBe("/terms?next=%2Fsales%3Ftab%3Dopen");
    expect(termsPath("/")).toBe("/terms");
    expect(termsPath("/terms?next=/sales")).toBe("/terms");
    expect(termsPath("//evil.example")).toBe("/terms");
    expect(termsPath(null)).toBe("/terms");
    expect(safeNextPath("/terms")).toBeNull();
  });
});

describe("background job retries", () => {
  it("waits longer after each failure, up to an hour", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(retryDelayMs(0)).toBe(30_000);
    expect(retryDelayMs(20)).toBe(60 * 60_000);
  });
});
