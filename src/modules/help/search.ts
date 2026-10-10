import type { HelpArticle, HelpSection } from "./types";

/*
 * The Help Center's search, run in the browser as people type. It looks in each
 * guide's title, keywords, summary and steps, in Bengali or English, and ranks
 * title and keyword matches first. Every word typed must match somewhere.
 */

/** One guide, flattened for searching (sent to the browser). */
export type HelpSearchEntry = {
  sectionId: string;
  sectionTitle: string;
  slug: string;
  title: string;
  summary: string;
  /** Whether the person's role opens the pages this guide is about. */
  open: boolean;
  keywords: string;
  body: string;
};

export type HelpSearchResult = HelpSearchEntry & { score: number };

/**
 * Text ready for matching: one Unicode form, lower case, no joiners (ZWJ/ZWNJ
 * change how Bengali looks, not what it says), punctuation as spaces.
 */
export function normalizeHelpText(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u200c\u200d]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/** The words of a search, normalised, without repeats. */
export function searchWords(query: string): string[] {
  return [...new Set(normalizeHelpText(query).split(" ").filter(Boolean))];
}

export function helpSearchEntry(
  section: Pick<HelpSection, "id" | "title">,
  article: HelpArticle,
  open: boolean,
): HelpSearchEntry {
  const body = [
    article.summary,
    article.who ?? "",
    ...article.steps.map((step) => step.text),
    ...(article.tips ?? []),
  ].join(" ");
  return {
    sectionId: section.id,
    sectionTitle: section.title,
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    open,
    keywords: normalizeHelpText(article.keywords.join(" ")),
    body: normalizeHelpText(body),
  };
}

/** How well one word matches a guide: 0 when it doesn't. */
function wordScore(word: string, entry: HelpSearchEntry, title: string, section: string): number {
  if (title.includes(word)) return 6;
  const keywords = ` ${entry.keywords} `;
  if (keywords.includes(` ${word} `)) return 5;
  if (keywords.includes(` ${word}`) || entry.keywords.includes(word)) return 4;
  if (section.includes(word)) return 2;
  if (entry.body.includes(word)) return 1;
  return 0;
}

/**
 * The guides matching every word of the query, best first (ties keep the
 * manual's order). An empty query matches nothing.
 */
export function searchHelp(entries: HelpSearchEntry[], query: string): HelpSearchResult[] {
  const words = searchWords(query);
  if (words.length === 0) return [];
  const results: HelpSearchResult[] = [];
  for (const entry of entries) {
    const title = normalizeHelpText(entry.title);
    const section = normalizeHelpText(entry.sectionTitle);
    let score = 0;
    let all = true;
    for (const word of words) {
      const s = wordScore(word, entry, title, section);
      if (s === 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) results.push({ ...entry, score });
  }
  // Array.prototype.sort is stable, so equal scores keep the manual's order.
  return results.sort((a, b) => b.score - a.score);
}
