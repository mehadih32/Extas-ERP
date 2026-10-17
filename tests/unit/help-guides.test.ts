import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ACCESS_TREE, leavesOf } from "@/components/settings/roles/access-tree";
import { PHONE_TABS, TOP_BAR_TABS } from "@/components/shell/nav-items";
import { HELP_SECTIONS } from "@/modules/help";
import { HELP_PICTURES } from "@/modules/help/pictures";
import type { HelpArticle } from "@/modules/help/types";
import { PERMISSIONS } from "@/modules/rbac/permissions";

import {
  guideHash,
  isPassingState,
  layouts,
  pages,
  patternOf,
  pressables,
  screenFiles,
  screenFingerprint,
  shellFiles,
  shotRoute,
  unreadLabels,
} from "../../scripts/help/screens";
import { UNREAD_LABELS } from "./help-unread";

/*
 * v6.4 E: every guide explains What (what the screen is and what each part
 * shows), Why (why it matters and when to use it, with a real example) and
 * How (the steps), and every button, tab, menu item, field and choice on
 * every screen is explained in the "Buttons and fields" list of a guide that
 * covers that screen (v6.4 L6): as an entry of its own, or quoted in an entry
 * (a choice in the entry of its field). Words seen on many screens ("Cancel",
 * the payment methods, the currencies) are explained once, in the Getting
 * started guide "common-buttons". A quote in a step alone is not enough. A
 * screen that gains a button fails here until its guide says what the button
 * does, in the same pull request.
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

/**
 * Whether a guide explains a word on a screen: in its "Buttons and fields" list
 * (v6.4 L6), as an entry or quoted in one. A quote in a step alone is not enough.
 */
const explains = (article: HelpArticle, label: string) =>
  (article.fields ?? []).some((f) => f.label === label || f.text.includes(`“${label}”`));

/** The guide to the words seen on many screens: it explains them for every screen. */
const COMMON = HELP_SECTIONS.find((s) => s.id === "getting-started")!.articles.find(
  (a) => a.slug === "common-buttons",
)!;

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

describe("The reader finds every word people press or pick (v6.4 L6)", () => {
  // A small app of its own, written for this test: the reader follows the words
  // through constants, lists of tabs, tables of words and components that show
  // what they are given, as the app's screens do.
  const app = mkdtempSync(path.join(os.tmpdir(), "help-words-"));
  afterAll(() => rmSync(app, { recursive: true, force: true }));
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(app, rel)), { recursive: true });
    writeFileSync(path.join(app, rel), text);
    return rel;
  };
  const files = [
    write(
      "src/components/x/tabs.ts",
      `export const X_TABS = [
         { href: "/x/one", label: "First tab" },
         { href: "/x/two", label: "Second tab" },
       ];
       export function visibleXTabs(held: string[]) {
         return X_TABS.filter(() => held.length > 0);
       }
       export const KIND_LABELS: Record<string, string> = { A: "Kind one", B: "Kind two" };`,
    ),
    write(
      "src/components/x/row.tsx",
      `export function RowOfTabs({ tabs }: { tabs: Array<{ href: string; label: string }> }) {
         const under = tabs.length > 3 ? tabs.slice(3).map((t) => t) : [];
         return <div>{under.map((tab) => <DropdownMenuItem key={tab.href}>{tab.label}</DropdownMenuItem>)}</div>;
       }
       export function PrintButton({ label = "Print it" }: { label?: string }) {
         return <Button>{label}</Button>;
       }
       export function SignOut({ children }: { children: React.ReactNode }) {
         return <button type="submit">{children}</button>;
       }
       export function Field({ label }: { label: string }) {
         return <Label>{label}</Label>;
       }
       export function WhyField({ label = "Reason given" }: { label?: string }) {
         return <Field label={label} />;
       }`,
    ),
    write(
      "src/app/(app)/x/page.tsx",
      `import { KIND_LABELS, visibleXTabs } from "@/components/x/tabs";
       import { Field, PrintButton, RowOfTabs, SignOut, WhyField } from "../../../components/x/row";
       const RANGES = [{ value: "week", label: "This week" }, { value: "month", label: "This month" }];
       export default function Page({ kind, held, who }: { kind: string; held: string[]; who: string }) {
         const save = held.length ? "Save the photo" : "Replace the proof";
         const tabs = visibleXTabs(held).map(({ href, label }) => ({ href, label }));
         return (
           <div>
             <RowOfTabs tabs={tabs} />
             <Button>{save}</Button>
             {RANGES.map((r) => <Button key={r.value}>{r.label}</Button>)}
             <Button>{KIND_LABELS[kind]}</Button>
             <Button aria-label="Remove the line"><XIcon /></Button>
             <PrintButton />
             <PrintButton label="Print the list" />
             <SignOut>Sign out now</SignOut>
             <Field label="Buyer's name" />
             <WhyField label="Why it moved" />
             <label><input type="checkbox" /> Keep me signed in</label>
             <select>
               <option value="">Not picked</option>
               <option value="mine">Only mine</option>
               <option value="n">{held.length} copies</option>
               <option value={who}>{who}{held.length ? "" : " (archived)"}</option>
             </select>
             <label>Paid by the factory, settled project by project.</label>
             <Button>{who}</Button>
           </div>
         );
       }`,
    ),
  ];

  it("reads tabs given to a component, constants, lists, tables, icon buttons, options and labels", () => {
    const words = pressables(app, files);
    for (const label of [
      "First tab",
      "Second tab",
      "Save the photo",
      "Replace the proof",
      "This week",
      "This month",
      "Kind one",
      "Kind two",
      "Remove the line",
      "Print it",
      "Print the list",
      "Sign out now",
      "Buyer's name",
      "Keep me signed in",
      "Why it moved",
      "Only mine",
    ])
      expect(words, label).toContain(label);
    // The "nothing picked" line, parts added to a name or a number, and a sentence are not words of their own.
    for (const label of [
      "Not picked",
      "(archived)",
      "copies",
      // A default that every screen replaces is never shown.
      "Reason given",
      "Paid by the factory, settled project by project.",
    ])
      expect(words, label).not.toContain(label);
  });

  it("lists a button whose words it cannot follow, so it needs a reason", () => {
    expect(unreadLabels(app, files)).toEqual([{ file: "src/app/(app)/x/page.tsx", code: "{who}" }]);
  });

  it("finds the app's own section tabs, profile tabs and menu choices", () => {
    const sales = path.join(ROOT, "src", "app", "(app)", "sales", "layout.tsx");
    expect(pressables(ROOT, screenFiles(ROOT, sales))).toEqual(
      expect.arrayContaining(["Orders", "Quotations", "Returns"]),
    );
    const employee = pages(ROOT).find((p) => p.route === "/hr/employees/[employeeId]")!;
    expect(pressables(ROOT, screenFiles(ROOT, employee.file, { layouts: false }))).toEqual(
      expect.arrayContaining(["Overview", "Leave", "Details"]),
    );
  });
});

describe("Every button and tab on every screen has its guide", () => {
  const appPages = pages(ROOT).filter((p) => p.file.includes(`${path.sep}(app)${path.sep}`));

  it("finds the screens and their buttons", () => {
    expect(appPages.length).toBeGreaterThan(150);
    const orders = appPages.find((p) => p.route === "/sales/orders/[orderId]")!;
    expect(pressables(ROOT, screenFiles(ROOT, orders.file))).toContain("Issue the invoice");
  });

  it("explains every button, tab, option and label of a screen in a guide that covers the screen", () => {
    const missing: string[] = [];
    for (const page of appPages) {
      const mine = articles.filter(({ article }) =>
        article.routes.some((route) => covers(route, segments(page.route))),
      );
      // The section's frame (its layout: the tabs) is checked once for the section, below.
      const files = screenFiles(ROOT, page.file, { layouts: false }).filter((f) => !SHELL.has(f));
      for (const label of pressables(ROOT, files)) {
        if (isPassingState(label)) continue;
        if (explains(COMMON, label) || mine.some(({ article }) => explains(article, label)))
          continue;
        missing.push(`${page.route}: ${label}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("explains the tabs and buttons of a section's frame in a guide of that section", () => {
    // A section's layout draws its tabs on every page of the section, so one
    // guide of the section (a page of it, or the whole section) explains them.
    const missing: string[] = [];
    for (const layout of layouts(ROOT)) {
      if (layout.route === "/") continue; // The frame of every page: Getting started, below.
      const mine = articles.filter(({ article }) =>
        article.routes.some(
          (route) => covers(layout.route, segments(route)) || covers(route, segments(layout.route)),
        ),
      );
      const files = screenFiles(ROOT, layout.file).filter((f) => !SHELL.has(f));
      for (const label of pressables(ROOT, files)) {
        if (isPassingState(label)) continue;
        if (explains(COMMON, label) || mine.some(({ article }) => explains(article, label)))
          continue;
        missing.push(`${layout.route} (its frame): ${label}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("counts a word as explained only in the Buttons and fields list", () => {
    const guide: HelpArticle = {
      ...COMMON,
      steps: [{ text: "“Zap it” চাপুন।" }],
      fields: [{ label: "Save it", text: "সেভ করে। ভুল হলে “Undo it” চাপুন।" }],
    };
    expect(explains(guide, "Zap it")).toBe(false);
    expect(explains(guide, "Save it")).toBe(true);
    expect(explains(guide, "Undo it")).toBe(true);
  });

  it("explains the buttons of the menu and the top bar in Getting started", () => {
    const start = articles.filter(({ section }) => section.id === "getting-started");
    const missing = pressables(ROOT, [...SHELL])
      .filter((label) => !isPassingState(label))
      .filter((label) => !start.some(({ article }) => explains(article, label)));
    expect(missing).toEqual([]);
  });

  it("follows every button's words to the text, or says why it cannot", () => {
    const files = [...new Set(appPages.flatMap((p) => screenFiles(ROOT, p.file)))];
    const unread = unreadLabels(ROOT, files).map(({ file, code }) => `${file}: ${code}`);
    expect(
      unread.filter((u) => !UNREAD_LABELS[u]),
      "Write the button's words in the code, or add it to tests/unit/help-unread.ts with the reason",
    ).toEqual([]);
    // A reason for a button that is gone, or now read, is taken out.
    expect(Object.keys(UNREAD_LABELS).filter((u) => !unread.includes(u))).toEqual([]);
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
