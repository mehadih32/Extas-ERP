import { describe, expect, it } from "vitest";

import { HELP_SECTIONS } from "@/modules/help";
import { GUIDE_CHARS, guideText, whatPoints } from "@/modules/help/guide-text";
import type { HelpArticle } from "@/modules/help/types";

/*
 * v6.4 L13: the Help AI answers from whole guides. The longest guides list
 * every button, and the AI read only their first 12,000 characters, so it
 * missed the buttons, mistakes and tips at the end.
 */

const all = HELP_SECTIONS.flatMap((section) =>
  section.articles.map((article) => ({ section, article })),
);

/** Every word of a guide the AI must have read. */
const partsOf = (article: HelpArticle) => [
  article.summary,
  ...whatPoints(article.what),
  article.why ?? "",
  article.next ?? "",
  ...article.steps.map((s) => s.text),
  ...(article.fields ?? []).flatMap((f) => [f.label, f.text]),
  ...(article.mistakes ?? []),
  ...(article.tips ?? []),
];

describe("what the Help AI reads of a guide", () => {
  it("reads the longest guide of the manual whole, to its last tip", () => {
    const longest = all
      .map(({ section, article }) => ({ article, text: guideText(section, article, true) }))
      .sort((a, b) => b.text.length - a.text.length)[0]!;
    expect(longest.text.length).toBeGreaterThan(12_000);
    expect(longest.text.length).toBeLessThanOrEqual(GUIDE_CHARS);
    for (const part of partsOf(longest.article)) expect(longest.text).toContain(part);
  });

  it("reads every guide whole", () => {
    const cut = all
      .filter(({ section, article }) => {
        const text = guideText(section, article, true);
        return partsOf(article).some((part) => !text.includes(part));
      })
      .map(({ article }) => article.slug);
    expect(cut).toEqual([]);
  });

  it("says when a guide is not open to the person's role", () => {
    const { section, article } = all[0]!;
    expect(guideText(section, article, false)).toContain("[not open to this person's role]");
    expect(guideText(section, article, true)).not.toContain("[not open");
  });

  it("leaves out tips first when a guide is ever longer than it can read", () => {
    const { section, article } = all[0]!;
    const big: HelpArticle = {
      ...article,
      what: undefined,
      why: undefined,
      next: undefined,
      steps: [{ text: "এক ধাপ" }],
      fields: [{ label: "Save", text: "ক".repeat(GUIDE_CHARS - 3_000) }],
      mistakes: ["একটি ভুল"],
      tips: ["প্রথম টিপ", "খ".repeat(5_000), "শেষ টিপ"],
    };
    const text = guideText(section, big, true);
    expect(text.length).toBeLessThanOrEqual(GUIDE_CHARS);
    expect(text).toContain("একটি ভুল");
    expect(text).toContain(`"Save": ${"ক".repeat(GUIDE_CHARS - 3_000)}`);
    expect(text).toContain("প্রথম টিপ");
    expect(text).not.toContain("শেষ টিপ");
  });
});
