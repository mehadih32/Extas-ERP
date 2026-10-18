import type { HelpArticle, HelpSection } from "./types";

/*
 * A guide as the Help AI reads it (v6.4 L13): the whole guide, its What, Why,
 * How, every button and field, what happens next, the common mistakes and the
 * tips. The longest guides list every button on their screen, so the AI must
 * read them to the end to answer about the last button.
 */

/** A guide's What as its points: one text is one point. */
export function whatPoints(what: HelpArticle["what"]): string[] {
  if (what === undefined) return [];
  return typeof what === "string" ? [what] : [...what];
}

/**
 * The most of one guide the AI reads: about twice the longest guide today
 * (16,000 characters in October 2026). tests/unit/help-ai-guides.test.ts fails
 * when a guide outgrows it.
 */
export const GUIDE_CHARS = 30_000;

/** One guide in plain text for the AI; tips are left out first if it is ever too long. */
export function guideText(
  section: Pick<HelpSection, "title">,
  article: HelpArticle,
  open: boolean,
): string {
  const main = [
    `## ${article.title} (${section.title})${open ? "" : " [not open to this person's role]"}`,
    article.summary,
    ...(article.what ? ["What:", ...whatPoints(article.what).map((p) => `- ${p}`)] : []),
    ...(article.why ? [`Why: ${article.why}`] : []),
    "How:",
    ...article.steps.map((s, i) => `${i + 1}. ${s.text}`),
    ...(article.fields?.length ? ["Buttons and fields:"] : []),
    ...(article.fields ?? []).map((f) => `- "${f.label}": ${f.text}`),
    ...(article.next ? [`What happens next: ${article.next}`] : []),
    ...(article.mistakes ?? []).map((m) => `- Common mistake: ${m}`),
  ].join("\n");
  let text = main.slice(0, GUIDE_CHARS);
  for (const tip of article.tips ?? []) {
    const line = `\n- ${tip}`;
    if (text.length + line.length > GUIDE_CHARS) break;
    text += line;
  }
  return text;
}
