import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * v6.4.1 C1 (the owner): no "..." on phones anywhere, tables included. A buyer's,
 * supplier's or company's name, an order, PO or booking number, an amount, an email
 * or a file name always shows whole: it wraps (break-words), or the screen lays it
 * out on two lines. A tooltip is no answer on a phone (there is no pointer).
 *
 * Tailwind's truncate, line-clamp-* and text-ellipsis are allowed only in the places
 * below, each with its reason. The layout checks (scripts/full-check/layout.mjs) catch
 * the rest on the real screens with long names; this catches a new "truncate" before.
 */

const root = path.resolve(__dirname, "../..");

/** Where cutting with "..." stays, and why (the file, and how many uses it may have). */
const ALLOWED: Record<string, { uses: number; why: string }> = {
  "src/components/shell/sidebar.tsx": {
    uses: 4,
    why: "the side menu's own short labels (Inbox, Help Center...): they always fit the wide menu; truncate only keeps them on one line while the menu narrows",
  },
  "src/components/reports/tag-placement.tsx": {
    uses: 1,
    why: "a tag's box drawn on the page picture, as small as its place on the page; the whole tag is in the list beside it (data-layout-cut-ok)",
  },
  "src/components/shell/truncated-titles.tsx": {
    uses: 2,
    why: "the code that gives cut text its tooltip on a computer (it names the classes)",
  },
};

/** Tailwind's cutting classes, as whole class names. */
const CUT = /(?<![\w-])(truncate|line-clamp-\d+|text-ellipsis)(?![\w-])/g;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

describe("Names and codes are never cut with ... (v6.4.1 C1)", () => {
  const uses = new Map<string, string[]>();
  for (const file of files(path.join(root, "src"))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(CUT)) {
        uses.set(rel, [...(uses.get(rel) ?? []), `${rel}:${i + 1} ${m[1]}`]);
      }
    });
  }

  it("no screen cuts text with truncate, line-clamp or text-ellipsis outside the allowed places", () => {
    const stray = [...uses].filter(([file]) => !ALLOWED[file]).flatMap(([, found]) => found);
    expect(stray).toEqual([]);
  });

  it("the allowed places keep to their count, each with a reason", () => {
    for (const [file, { uses: n, why }] of Object.entries(ALLOWED)) {
      expect(why.length, file).toBeGreaterThan(20);
      expect(uses.get(file)?.length ?? 0, file).toBe(n);
    }
  });

  it("the cut tag box on the page picture is marked as cut on purpose", () => {
    const src = readFileSync(path.join(root, "src/components/reports/tag-placement.tsx"), "utf8");
    const at = src.indexOf('"absolute truncate');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, at - 1200), at)).toContain("data-layout-cut-ok");
  });
});
