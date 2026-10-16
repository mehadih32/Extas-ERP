import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  clipsOwnText,
  controlsOverlap,
  coversBengali,
  dedupe,
  familiesOf,
  HEIGHTS,
  isBengaliFamily,
  isReadable,
  isTiny,
  LIB_SOURCE,
  missingFrom,
  outsideWidth,
  problemLine,
  RULES,
  safeSelector,
  scrollsOnPurpose,
  textOverlaps,
  WIDTHS,
} from "../../scripts/full-check/layout.mjs";
import {
  fixIssue,
  KIND_LABEL,
  KIND_TEXT,
  LAYOUT_RULES,
  PROBLEM_KINDS,
  safeLayoutPlace,
} from "@/modules/ai/full-check/texts";

import { isCheckDatabase } from "../../scripts/layout-session";

/*
 * v6.4 B2: the layout checks' rules (scripts/full-check/layout.mjs), the same
 * functions the browser runs on every screen. The checks themselves are tested on
 * made-up screens in a real browser by scripts/full-check/layout-selftest.mjs.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("The layout checks' rules", () => {
  it("check the four widths: phone, tablet, laptop and large desktop", () => {
    expect(WIDTHS).toEqual([390, 768, 1366, 1920]);
    for (const width of WIDTHS) expect(HEIGHTS[width as keyof typeof HEIGHTS]).toBeGreaterThan(0);
    expect(Object.keys(RULES).sort()).toEqual(
      [
        "BENGALI",
        "CUT_TEXT",
        "EMPTY_TABLE",
        "FONT",
        "MENU",
        "OFF_SCREEN",
        "OVERFLOW",
        "OVERLAP",
        "TINY",
      ].sort(),
    );
  });

  it("find text cut by its own box, unless a tooltip holds the whole of it", () => {
    const cut = {
      overflowX: "hidden",
      overflowY: "hidden",
      textOverflow: "clip",
      scrollWidth: 140,
      clientWidth: 80,
      scrollHeight: 20,
      clientHeight: 20,
      titled: false,
      lineClamp: false,
    };
    expect(clipsOwnText(cut)).toBe("x");
    // "..." alone hides the rest; with a tooltip ("title") the whole text is reachable.
    expect(clipsOwnText({ ...cut, textOverflow: "ellipsis" })).toBe("x");
    expect(clipsOwnText({ ...cut, textOverflow: "ellipsis", titled: true })).toBeNull();
    // Text that fits, or a box that lets it show, cuts nothing.
    expect(clipsOwnText({ ...cut, scrollWidth: 81 })).toBeNull();
    expect(clipsOwnText({ ...cut, overflowX: "visible", overflowY: "visible" })).toBeNull();
    // Lines cut off at the bottom; a line clamp with a tooltip is fine.
    const tall = { ...cut, scrollWidth: 80, scrollHeight: 60 };
    expect(clipsOwnText(tall)).toBe("y");
    expect(clipsOwnText({ ...tall, titled: true, lineClamp: true })).toBeNull();
  });

  it("count a row that scrolls as cut when its scroll bar is hidden and it gives no cue", () => {
    expect(scrollsOnPurpose({ overflow: "auto", scrollbarWidth: "auto", cue: false })).toBe(true);
    expect(scrollsOnPurpose({ overflow: "auto", scrollbarWidth: "thin", cue: false })).toBe(true);
    // The AI Center's old tab row: it scrolled with its scroll bar hidden ("Settings" showed as "S").
    expect(scrollsOnPurpose({ overflow: "auto", scrollbarWidth: "none", cue: false })).toBe(false);
    expect(scrollsOnPurpose({ overflow: "auto", scrollbarWidth: "none", cue: true })).toBe(true);
    expect(scrollsOnPurpose({ overflow: "hidden", scrollbarWidth: "auto", cue: true })).toBe(false);
  });

  it("find text over text and buttons over buttons, not lines that only touch", () => {
    expect(textOverlaps(box(0, 0, 100, 20), box(10, 2, 120, 22))).toBe(true);
    // Tight lines (line-height 1) share a few pixels: not an overlap.
    expect(textOverlaps(box(0, 0, 100, 20), box(0, 17, 100, 37))).toBe(false);
    expect(textOverlaps(box(0, 0, 100, 20), box(101, 0, 200, 20))).toBe(false);
    // Buttons side by side share a border; a button on top of another does not.
    expect(controlsOverlap(box(0, 0, 100, 36), box(99, 0, 200, 36))).toBe(false);
    expect(controlsOverlap(box(0, 0, 100, 36), box(60, 10, 160, 46))).toBe(true);
  });

  it("find what sticks out of the window", () => {
    expect(outsideWidth(box(0, 0, 390, 10), 390)).toBe(false);
    expect(outsideWidth(box(0, 0, 391, 10), 390)).toBe(false);
    expect(outsideWidth(box(300, 0, 420, 10), 390)).toBe(true);
    expect(outsideWidth(box(-20, 0, 100, 10), 390)).toBe(true);
  });

  it("know the app's fonts and which have Bengali letters", () => {
    expect(familiesOf(`"inter", "inter Fallback", "bengali", ui-sans-serif, sans-serif`)).toEqual([
      "inter",
      "inter fallback",
      "bengali",
      "ui-sans-serif",
      "sans-serif",
    ]);
    // The app's Bengali font is declared for the Bengali letters only (src/app/fonts.ts).
    expect(coversBengali("U+0964-0965, U+0980-09FE, U+200C-200D, U+25CC")).toBe(true);
    expect(coversBengali("U+0000-00FF, U+0131")).toBe(false);
    expect(isBengaliFamily("bengali", "U+0964-0965, U+0980-09FE")).toBe(true);
    expect(isBengaliFamily("Noto Sans Bengali", "U+0-10FFFF")).toBe(true);
    // A face for every character says nothing: Inter has no Bengali letters.
    expect(isBengaliFamily("inter", "U+0-10FFFF")).toBe(false);
    expect(isBengaliFamily("inter", "")).toBe(false);
    expect(isBengaliFamily("playfair", "U+0000-00FF")).toBe(false);
  });

  it("count text under 12 px as too small, only when it has letters or digits", () => {
    expect(isTiny(10)).toBe(true);
    expect(isTiny(11)).toBe(true);
    expect(isTiny(12)).toBe(false);
    expect(isTiny(16)).toBe(false);
    expect(isReadable("Total due")).toBe(true);
    expect(isReadable("বাকি")).toBe(true);
    expect(isReadable("·")).toBe(false);
    expect(isReadable("→")).toBe(false);
  });

  it("list the menu items that cannot be reached", () => {
    expect(missingFrom(["/", "/sales", "/ai", "/ai"], ["/", "/sales"])).toEqual(["/ai"]);
    expect(missingFrom(["/a"], ["/a", "/b"])).toEqual([]);
  });

  it("say where a problem is with tags and class names only, never the screen's text", () => {
    expect(safeSelector("header > nav.flex.w-full > a.inline-flex.shrink-0:nth-of-type(16)")).toBe(
      "header > nav.flex.w-full > a.inline-flex.shrink-0:nth-of-type(16)",
    );
    expect(safeSelector("main > div > span[data-slot]:nth-of-type(2)")).toBe(
      "main > div > span[data-slot]:nth-of-type(2)",
    );
    expect(safeSelector('a[href="/parties/Rahim"]')).toBe("(an element)");
    expect(safeSelector("p:contains(Rahim owes 45000)")).toBe("(an element)");
    expect(safeSelector("p.বাকি")).toBe("(an element)");
    expect(safeSelector("")).toBe("(an element)");
    expect(
      problemLine({
        kind: "LAYOUT",
        width: 390,
        what: "CUT_TEXT",
        where: "nav > a",
        detail: '"Settings" is cut',
      }),
    ).toBe("LAYOUT 390 CUT_TEXT nav > a");
  });

  it("report each problem once, and a few of each kind at most", () => {
    const p = (what: string, where: string) => ({ kind: "LAYOUT", width: 390, what, where });
    const many = Array.from({ length: 10 }, (_, i) => p("TINY", `p:nth-of-type(${i + 1})`));
    const out = dedupe([p("CUT_TEXT", "nav > a"), p("CUT_TEXT", "nav > a"), ...many]);
    expect(out.filter((x) => x.what === "CUT_TEXT")).toHaveLength(1);
    expect(out.filter((x) => x.what === "TINY")).toHaveLength(6);
  });

  it("run inside the page as one block of code whose rules can use each other", () => {
    const lib = (0, eval)(LIB_SOURCE) as {
      textOverlaps: typeof textOverlaps;
      isTiny: typeof isTiny;
      isBengaliFamily: typeof isBengaliFamily;
    };
    expect(lib.textOverlaps(box(0, 0, 100, 20), box(10, 2, 120, 22))).toBe(true);
    expect(lib.isTiny(11)).toBe(true);
    expect(lib.isBengaliFamily("bengali", "U+0980-09FE")).toBe(true);
  });
});

describe("Layout problems in the Full check", () => {
  it("are their own kind, in plain words", () => {
    expect(PROBLEM_KINDS).toContain("LAYOUT");
    expect(KIND_LABEL.LAYOUT).toBe("Layout");
    expect(KIND_TEXT.LAYOUT).toBe("Text is cut or does not fit the screen");
    // The ERP and the engine use the same words for each rule.
    expect(LAYOUT_RULES).toEqual(RULES);
  });

  it("go to Claude Code as the route, the width, the rule and the place: never the screen's text", () => {
    for (const s of [
      "header > nav.flex.w-full > a.inline-flex.shrink-0:nth-of-type(16)",
      'a[href="/parties/Rahim"]',
      "p.বাকি",
      "td:contains(Rahim)",
    ]) {
      expect(safeLayoutPlace(s)).toBe(safeSelector(s));
    }
    const { title, body } = fixIssue({
      problems: [
        {
          kind: "LAYOUT",
          screen: "/parties/buyers/cm4x1y2z3a4b5c6d7e8f9g0h1",
          pattern: "/parties/[list]/[partyId]",
          detail: [
            "LAYOUT 390 CUT_TEXT header > nav.flex > a.shrink-0:nth-of-type(3)",
            '"Rahim Textiles owes 45000" is cut by the box around it',
            "LAYOUT 768 MENU a[href=/parties/Rahim]",
            "LAYOUT 1366 MADE_UP main > p",
          ].join("\n"),
          ms: null,
        },
      ],
      site: "demo",
      at: "2026-10-16 05:00 UTC",
      runId: "run1",
      issue: 7,
    });
    expect(title).toBe("Full check: Layout on /parties/[list]/[partyId]");
    expect(body).toContain(
      "**Text is cut or does not fit the screen** on `/parties/[list]/[partyId]`",
    );
    expect(body).toContain(
      "`390 px: Text is cut at header > nav.flex > a.shrink-0:nth-of-type(3)`",
    );
    expect(body).toContain("`768 px: A menu item cannot be reached at (an element)`");
    expect(body).not.toContain("Rahim");
    expect(body).not.toContain("45000");
    expect(body).not.toContain("MADE_UP");
  });
});

describe("Where the layout checks run", () => {
  it("in the Full check, at the four widths, as LAYOUT problems", () => {
    const crawler = read("scripts/full-check/crawl.mjs");
    expect(crawler).toContain('from "./layout.mjs"');
    expect(crawler).toContain('"LAYOUT"');
  });

  it("on every pull request that changes the screens, on a throwaway copy of the demo data", () => {
    const yml = read(".github/workflows/layout-checks.yml");
    expect(yml).toMatch(/pull_request:\n\s+paths:/);
    for (const p of ['"src/**"', '"public/**"', '"scripts/full-check/**"'])
      expect(yml).toContain(p);
    expect(yml).toMatch(/permissions:\n\s+contents: read\n/);
    expect(yml).not.toMatch(/secrets\./);
    expect(yml).toContain("POSTGRES_DB: extras_demo");
    expect(yml).toContain("npx tsx prisma/demo/seed-demo.ts");
    expect(yml).toContain("node scripts/full-check/layout-selftest.mjs");
    expect(yml).toContain("node scripts/full-check/layout-run.mjs");
    expect(yml).toContain("LAYOUT_LOOK=LEGACY");
    expect(yml).toContain("LAYOUT_LOOK=MODERN");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["layout:check"]).toBe("node scripts/full-check/layout-run.mjs");
  });

  it("make their session only in a database made for checks, never the live ERP's", () => {
    expect(isCheckDatabase("extras_demo")).toBe(true);
    expect(isCheckDatabase("extras_layout")).toBe(true);
    expect(isCheckDatabase("extras_erp_ui_b")).toBe(true);
    expect(isCheckDatabase("extras_erp")).toBe(false);
    expect(isCheckDatabase("extras_erp_test")).toBe(false);
    expect(isCheckDatabase(undefined)).toBe(false);
  });
});
