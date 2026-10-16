import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ACCESS_TREE, leavesOf } from "@/components/settings/roles/access-tree";
import { PHONE_TABS, TOP_BAR_TABS } from "@/components/shell/nav-items";
import { HELP_SECTIONS } from "@/modules/help";
import { HELP_PICTURES } from "@/modules/help/pictures";
import type { HelpArticle } from "@/modules/help/types";
import { PERMISSIONS } from "@/modules/rbac/permissions";

import {
  guideHash,
  isPassingState,
  pages,
  patternOf,
  pressables,
  screenFiles,
  screenFingerprint,
  shellFiles,
  shotRoute,
} from "../../scripts/help/screens";

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

/** Every word of a guide: its title, search words, What, Why, How, pictures, buttons, tips and mistakes. */
const textsOf = (article: HelpArticle) => [
  article.title,
  article.summary,
  ...article.keywords,
  article.who ?? "",
  article.what ?? "",
  article.why ?? "",
  article.next ?? "",
  ...article.steps.flatMap((s) => [s.text, s.image?.caption ?? ""]),
  ...(article.tips ?? []),
  ...(article.mistakes ?? []),
  ...(article.fields ?? []).flatMap((f) => [f.label, f.text]),
];

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
const SHELL = shellFiles(ROOT);

/** Whether the app shows a label; "…" stands for a name the screen fills in ("Load the … items"). */
const shows = (app: string, label: string) =>
  app.includes(label) ||
  new RegExp(
    label
      .split("…")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".{1,80}?"),
  ).test(app);

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
        .filter((f) => !shows(app, f.label))
        .map((f) => `${section.id}/${article.slug}: ${f.label}`),
    );
    expect(missing).toEqual([]);
  });

  it("writes numbers with Western digits (0-9) in every word of every guide (v6.4 L7)", () => {
    const bad = articles.flatMap(({ section, article }) =>
      textsOf(article)
        .filter((text) => BENGALI_DIGIT.test(text))
        .map((text) => `${section.id}/${article.slug}: ${text.slice(0, 60)}`),
    );
    for (const section of HELP_SECTIONS) {
      for (const text of [section.title, section.description]) {
        if (BENGALI_DIGIT.test(text)) bad.push(`${section.id}: ${text.slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("writes numbers with Western digits on the Help Center's own screens too", () => {
    const help = [
      path.join(ROOT, "src", "components", "help"),
      path.join(ROOT, "src", "app", "(app)", "help"),
      path.join(ROOT, "src", "modules", "help"),
    ];
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return files(full);
        return /\.(tsx?|json)$/.test(name) ? [full] : [];
      });
    const bad = help
      .flatMap(files)
      .filter((file) => BENGALI_DIGIT.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(bad).toEqual([]);
  });

  it("names a permission by its words on the Roles screen, never by its code (v6.4 L11)", () => {
    const words = new Map(ACCESS_TREE.flatMap(leavesOf).map((leaf) => [leaf.key, leaf.label]));
    const bad = articles.flatMap(({ section, article }) =>
      textsOf(article).flatMap((text) =>
        PERMISSIONS.filter(({ key }) =>
          new RegExp(`(^|[^\\w.])${key.replace(/\./g, "\\.")}(?![\\w.])`).test(text),
        ).map(({ key }) => `${section.id}/${article.slug}: ${key} → “${words.get(key)}”`),
      ),
    );
    expect(bad).toEqual([]);
  });

  it("counts the top bar's sections at each width as the app shows them (v6.4 L11)", () => {
    // Tailwind's widths: md from 768 px (tablets), lg from 1024 px, xl from 1280 px,
    // so a 1366 px laptop and a 1920 px screen show TOP_BAR_TABS.xl sections.
    const menu = articles.find(({ article }) => article.slug === "find-your-way")!.article;
    expect(menu.what).toContain(
      `ট্যাবলেটে ${TOP_BAR_TABS.md}টি, 1024 থেকে 1279 px চওড়া ছোট ল্যাপটপে ${TOP_BAR_TABS.lg}টি, ` +
        `সাধারণ ল্যাপটপ (1366 px) ও বড় পর্দায় ${TOP_BAR_TABS.xl}টি`,
    );
    expect(menu.what).toContain(`প্রথম ${PHONE_TABS}টি অংশ`);
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

describe("Every guide has its automatic picture, and it is not old", () => {
  const HOW = "Take it with: npm run help:shots (scripts/help/plan.ts says how)";

  it("knows a guide's page and what its picture marks", () => {
    expect(patternOf(ROOT, "/parties/buyers")).toBe("/parties/[list]");
    expect(patternOf(ROOT, "/parties/dues")).toBe("/parties/dues");
    expect(patternOf(ROOT, "/no/such/page")).toBeNull();
    const guide = { routes: ["/sales/orders"], steps: [{ text: "“Issue the invoice” চাপুন" }] };
    expect(shotRoute(guide)).toBe("/sales/orders");
    expect(shotRoute({ ...guide, routes: [] })).toBe("/");
    // Other words in a step keep the picture; another button needs a new one.
    expect(guideHash({ ...guide, steps: [{ text: "এবার “Issue the invoice”" }] })).toBe(
      guideHash(guide),
    );
    expect(guideHash({ ...guide, steps: [{ text: "“Void”" }] })).not.toBe(guideHash(guide));
    expect(guideHash({ ...guide, shot: { open: "New order" } })).not.toBe(guideHash(guide));
  });

  it("every guide has a picture of its own page, and the file is there", () => {
    const missing = articles
      .filter(({ article }) => {
        const picture = HELP_PICTURES[article.slug];
        return (
          !picture ||
          picture.route !== shotRoute(article) ||
          !existsSync(path.join(ROOT, "public", picture.src))
        );
      })
      .map(({ section, article }) => `${section.id}/${article.slug}`);
    expect(missing, HOW).toEqual([]);
  });

  it("a guide whose screen or steps changed has a new picture", () => {
    const old = articles
      .filter(({ article }) => HELP_PICTURES[article.slug])
      .filter(({ article }) => {
        const picture = HELP_PICTURES[article.slug]!;
        return (
          picture.screen !== screenFingerprint(ROOT, shotRoute(article), SHELL) ||
          picture.guide !== guideHash(article)
        );
      })
      .map(({ section, article }) => `${section.id}/${article.slug}`);
    expect(old, HOW).toEqual([]);
  });

  it("marks only steps the guide has", () => {
    const bad = articles
      .filter(({ article }) =>
        (HELP_PICTURES[article.slug]?.marks ?? []).some((n) => n < 1 || n > article.steps.length),
      )
      .map(({ section, article }) => `${section.id}/${article.slug}`);
    expect(bad).toEqual([]);
  });
});
