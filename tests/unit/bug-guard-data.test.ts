import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { DATA_CHECKS } from "@/modules/bug-guard/checks/data";
import {
  amount,
  findings,
  fixed,
  type Item,
  MAX_FINDINGS,
  quantity,
} from "@/modules/bug-guard/checks/data-common";

/*
 * Bug Guard's data checks, the parts that need no database: how figures are
 * written for the owner, the cap of 20 findings per check (the rest become one
 * summary finding), the checks' keys, and the ERP labels their words quote.
 */

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  severity: "IMPORTANT",
  title: `সমস্যা ${id}`,
  place: id,
  why: "কেন",
  fix: "কী করতে হবে",
  fixKind: "MANUAL",
  ...over,
});

describe("Bug Guard data checks: figures and findings", () => {
  it("writes money and quantities the way the owner reads them", () => {
    expect(amount(1234567.5)).toBe("1,234,567.50");
    expect(amount("-4000")).toBe("-4,000.00");
    expect(amount(null)).toBe("0.00");
    expect(amount(0.005)).toBe("0.01");
    expect(fixed("12.5")).toBe("12.50");
    expect(quantity(1200)).toBe("1,200");
    expect(quantity("12.500")).toBe("12.5");
    expect(quantity(0.1234)).toBe("0.123");
    expect(quantity(-3)).toBe("-3");
  });

  it("keys each finding by its check and record, the worst first", () => {
    const found = findings(
      "data.test.thing",
      [
        item("b", { severity: "LATER", place: "A-2" }),
        item("a", { place: "B-1" }),
        item("c", { severity: "URGENT", place: "C-3", href: "/x/c" }),
      ],
      "অমিল",
    );
    expect(found.map((f) => [f.key, f.severity])).toEqual([
      ["data.test.thing:c", "URGENT"],
      ["data.test.thing:a", "IMPORTANT"],
      ["data.test.thing:b", "LATER"],
    ]);
    expect(found[0]).toMatchObject({
      area: "DATA",
      href: "/x/c",
      evidence: [],
      correction: null,
    });
    expect(findings("data.test.thing", [], "কিছু")).toEqual([]);
  });

  it("reports at most 20 per check: the first 19, then one finding for the rest", () => {
    const twenty = Array.from({ length: MAX_FINDINGS }, (_, n) =>
      item(`r${String(n).padStart(2, "0")}`),
    );
    expect(findings("data.test.many", twenty, "অমিল")).toHaveLength(20);
    expect(findings("data.test.many", twenty, "অমিল").some((f) => f.key.endsWith(":more"))).toBe(
      false,
    );

    const many = [
      ...Array.from({ length: 24 }, (_, n) =>
        item(`r${String(n).padStart(2, "0")}`, { severity: "LATER" }),
      ),
      item("u1", { severity: "URGENT", place: "ZZ" }),
    ];
    const found = findings("data.test.many", many, "লাইনের অমিল");
    expect(found).toHaveLength(MAX_FINDINGS);
    expect(found[0]!.key).toBe("data.test.many:u1");
    const more = found[MAX_FINDINGS - 1]!;
    expect(more).toMatchObject({
      key: "data.test.many:more",
      severity: "LATER",
      fixKind: "MANUAL",
      correction: null,
    });
    expect(more.title).toBe("লাইনের অমিল: আরও 6টি একই রকম সমস্যা আছে");
    expect(more.evidence![0]).toEqual({ label: "মোট বাকি", value: "6" });
    expect(more.evidence!.slice(1).map((e) => e.value)).toEqual([
      "r18",
      "r19",
      "r20",
      "r21",
      "r22",
    ]);
    // The summary keeps the worst of what it holds.
    const worst = findings(
      "data.test.many",
      Array.from({ length: 21 }, (_, n) =>
        item(`x${String(n).padStart(2, "0")}`, { severity: n === 20 ? "URGENT" : "LATER" }),
      ),
      "অমিল",
    );
    expect(worst.at(-1)).toMatchObject({ key: "data.test.many:more", severity: "LATER" });
    expect(worst[0]!.severity).toBe("URGENT");
  });
});

describe("Bug Guard data checks: keys and words", () => {
  it("has one key per check, data.<group>.<name>, with an English label", () => {
    const keys = DATA_CHECKS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of DATA_CHECKS) {
      expect(c.key).toMatch(/^data\.[a-z]+\.[a-z]+$/);
      expect(c.area).toBe("DATA");
      expect(c.platform ?? false).toBe(false);
      expect(c.label).toMatch(/^[A-Z][A-Za-z ,'-]+$/);
    }
    // The owner's 2b list, group by group.
    expect([...new Set(keys.map((k) => k.split(".")[1]))]).toEqual([
      "ledger",
      "posting",
      "stock",
      "totals",
      "money",
      "links",
    ]);
  });

  it("quotes only labels the ERP shows, exactly", () => {
    const SRC = join(process.cwd(), "src");
    const CHECKS = join(SRC, "modules", "bug-guard", "checks");
    const filesUnder = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? filesUnder(path) : [path];
      });
    const app = filesUnder(SRC)
      .filter((p) => /\.tsx?$/.test(p) && !p.includes(`${join("modules", "bug-guard")}`))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n")
      .replaceAll("&apos;", "'")
      .replaceAll("&amp;", "&")
      .replace(/\s+/g, " ");
    const missing: string[] = [];
    const checks = filesUnder(CHECKS).filter((p) => /data[-a-z]*\.ts$/.test(p));
    expect(checks.length).toBeGreaterThanOrEqual(7);
    for (const file of checks) {
      const text = readFileSync(file, "utf8");
      // Bengali is written as it is, with Western digits.
      expect(text, file).not.toMatch(/[০-৯]/);
      for (const [, quoted] of text.matchAll(/“([^”]+)”/g)) {
        // A label filled in at run time, or a Bengali phrase, is not an ERP label.
        if (quoted!.includes("${") || !/[A-Za-z]/.test(quoted!)) continue;
        // As a whole string or a screen's text, not a piece of a longer one.
        const forms = [
          `"${quoted}"`,
          `'${quoted}'`,
          `\`${quoted}\``,
          `>${quoted}<`,
          `> ${quoted} <`,
        ];
        if (!forms.some((form) => app.includes(form))) {
          missing.push(`${relative(CHECKS, file)}: ${quoted}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
