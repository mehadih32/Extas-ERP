import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HELP_SECTIONS } from "@/modules/help";
import type { HelpArticle } from "@/modules/help/types";

import { pages, pressables, screenFiles, isPassingState } from "../../scripts/help/screens";

/*
 * v6.4 E: every guide explains What (what the screen is and what each part
 * shows), Why (why it matters and when to use it, with a real example) and
 * How (the steps), and every button and tab on every screen is explained by a
 * guide that covers that screen, in its "Buttons and fields" list or quoted
 * in its text. A screen that gains a button fails here until its guide says
 * what the button does, in the same pull request.
 */

const ROOT = process.cwd();
const BENGALI = /[ঀ-৿]/;
const BENGALI_DIGIT = /[০-৯]/;

const articles = HELP_SECTIONS.flatMap((section) =>
  section.articles.map((article) => ({ section, article })),
);

const segments = (route: string) => route.split("/").filter(Boolean);
const dynamic = (part: string) => /^\[.*\]$/.test(part);
/** A guide's route covers a page when it is the page or a page above it ([id] matches anything). */
const covers = (route: string, page: string[]) => {
  const parts = segments(route);
  if (parts.length === 0) return page.length === 0;
  if (parts.length > page.length) return false;
  return parts.every((p, i) => p === page[i] || (dynamic(p) && dynamic(page[i]!)));
};

/** Everything a guide says, to find the words of a button in. */
const saysOf = (article: HelpArticle) =>
  [
    article.summary,
    article.what ?? "",
    article.why ?? "",
    article.who ?? "",
    article.next ?? "",
    ...article.steps.map((s) => s.text),
    ...(article.tips ?? []),
    ...(article.mistakes ?? []),
    ...(article.fields ?? []).map((f) => f.text),
  ].join("\n");

/** Whether a guide explains a button: in its list, or quoted in its words. */
const explains = (article: HelpArticle, label: string) =>
  (article.fields ?? []).some((f) => f.label === label) || saysOf(article).includes(`“${label}”`);

/** The files of the frame around every page (menu, top bar): their buttons are the "Getting started" guides'. */
const SHELL = new Set(screenFiles(ROOT, path.join(ROOT, "src", "app", "(app)", "layout.tsx")));

describe("What, Why and How in every guide", () => {
  it("every guide says what it is and why it matters, in Bengali", () => {
    const missing = articles
      .filter(
        ({ article }) =>
          !article.what ||
          !article.why ||
          !BENGALI.test(article.what) ||
          !BENGALI.test(article.why) ||
          article.what.length < 80 ||
          article.why.length < 80,
      )
      .map(({ section, article }) => `${section.id}/${article.slug}`);
    expect(missing).toEqual([]);
  });

  it("every guide has its steps (How)", () => {
    const missing = articles
      .filter(({ article }) => article.steps.length === 0)
      .map(({ section, article }) => `${section.id}/${article.slug}`);
    expect(missing).toEqual([]);
  });

  it("explains each button and field in Bengali, by its exact English words, once per guide", () => {
    const bad: string[] = [];
    for (const { section, article } of articles) {
      const seen = new Set<string>();
      for (const f of article.fields ?? []) {
        const where = `${section.id}/${article.slug}: ${f.label}`;
        if (seen.has(f.label)) bad.push(`${where} (twice)`);
        seen.add(f.label);
        if (!f.label.trim() || f.label !== f.label.trim()) bad.push(`${where} (spaces)`);
        if (!BENGALI.test(f.text)) bad.push(`${where} (not Bengali)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("names each button and field by words the app really shows", () => {
    const src = path.join(ROOT, "src");
    const content = path.join(src, "modules", "help", "content");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return files(full);
        return /\.tsx?$/.test(name) && !full.startsWith(content) ? [full] : [];
      });
    const app = files(src)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")
      .replaceAll("&apos;", "'")
      .replaceAll("&amp;", "&")
      .replace(/\s+/g, " ");
    const missing = articles.flatMap(({ section, article }) =>
      (article.fields ?? [])
        .filter((f) => !app.includes(f.label))
        .map((f) => `${section.id}/${article.slug}: ${f.label}`),
    );
    expect(missing).toEqual([]);
  });

  it("writes numbers with Western digits in the new parts", () => {
    const bad = articles
      .filter(({ article }) =>
        [
          article.what ?? "",
          article.why ?? "",
          article.next ?? "",
          ...(article.mistakes ?? []),
          ...(article.fields ?? []).map((f) => f.text),
        ].some((text) => BENGALI_DIGIT.test(text)),
      )
      .map(({ section, article }) => `${section.id}/${article.slug}`);
    expect(bad).toEqual([]);
  });
});

describe("Every button and tab on every screen has its guide", () => {
  const appPages = pages(ROOT).filter((p) => p.file.includes(`${path.sep}(app)${path.sep}`));

  it("finds the screens and their buttons", () => {
    expect(appPages.length).toBeGreaterThan(150);
    const orders = appPages.find((p) => p.route === "/sales/orders/[orderId]")!;
    expect(pressables(ROOT, screenFiles(ROOT, orders.file))).toContain("Issue the invoice");
  });

  it("explains every button and tab of a screen in a guide that covers the screen", () => {
    const missing: string[] = [];
    for (const page of appPages) {
      const mine = articles.filter(({ article }) =>
        article.routes.some((route) => covers(route, segments(page.route))),
      );
      const files = screenFiles(ROOT, page.file).filter((f) => !SHELL.has(f));
      for (const label of pressables(ROOT, files)) {
        if (isPassingState(label)) continue;
        if (mine.some(({ article }) => explains(article, label))) continue;
        missing.push(`${page.route}: ${label}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("explains the buttons of the menu and the top bar in Getting started", () => {
    const start = articles.filter(({ section }) => section.id === "getting-started");
    const missing = pressables(ROOT, [...SHELL])
      .filter((label) => !isPassingState(label))
      .filter((label) => !start.some(({ article }) => explains(article, label)));
    expect(missing).toEqual([]);
  });
});
