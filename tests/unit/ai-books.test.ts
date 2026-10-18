import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
 * The K3 book (a buying-house owner's knowledge) teaches Mehedi 2.0 how the
 * owner costs an order, so it must follow the owner's v6.2 rules throughout:
 * profit % set per order (no default, at least 10%, no upper limit: v6.4.2),
 * no office overhead, CM fixed
 * per style with the factory (never from minutes or SMV), fabric at the
 * supplier's price per kg, and the Order check card instead of a score.
 */

const DIR = join(process.cwd(), "assets", "knowledge");
const k3 = readFileSync(join(DIR, "K3.md"), "utf8");
const tests = JSON.parse(readFileSync(join(DIR, "tests.json"), "utf8")) as Record<
  string,
  { questions: Array<{ n: number; q: string; expected: string; v62?: string }> }
>;

describe("the K3 book follows the owner's costing rules (v6.2)", () => {
  it("has none of the old costing parts", () => {
    for (const old of [
      // The old gross-up with 3% overhead and 7% profit (its 11.15% and 0.8885 are now
      // 1% + 0.15% + the owner's 10%, so the overhead sum itself is looked for).
      "1 + 0.15 + 3 + 0 + 7",
      "39.20 ÷ 0.8885",
      "75.87 ÷ 0.8885",
      // Profit under the owner's 10% minimum (v6.4.2), or the old "no floor".
      "লাভ 8%",
      "8% দিয়েছেন",
      "8%-এর",
      "0.9085",
      "সর্বনিম্ন সীমা (floor) নেই",
      "Overhead:** 3%",
      "SMV × CM rate",
      "SMV 12 × 0.055",
      "CM rate/min",
      "Estimated CM",
      "Score =",
      "70 বা বেশি: go",
      "সর্বনিম্ন লাভ 5%",
      "দাম/kg = [(yarn",
      "Floor, target, opening, walk-away",
      "knock-out",
    ]) {
      expect(k3, old).not.toContain(old);
    }
  });

  it("costs with the owner's profit %, the supplier's fabric price and the CM agreed with the factory", () => {
    expect(k3).toContain("Profit % for this order");
    expect(k3).toContain("Order check card");
    expect(k3).toContain("FOB = খরচ ÷ 0.8885");
    expect(k3).toContain("সর্বনিম্ন 10%, ওপরে কোনো সীমা নেই");
    expect(k3).toContain("সাপ্লায়ারের কেজির দাম");
    expect(k3).toContain("CM ঠিক হয় ফ্যাক্টরির সাথে চুক্তিতে, স্টাইল ধরে");
    // The Order check card's five checks, as the costing screen shows them.
    for (const check of ["Price vs cost", "Time to ship", "Factory", "Buyer payment", "Risks"]) {
      expect(k3).toContain(check);
    }
  });

  it("works its examples out the v6.2 way at the owner's 10%: the polo at 38.85 a dozen is 43.73", () => {
    expect(k3).toContain("| **FOB** | 38.85 ÷ 0.8885 | **43.73 (পিসে 3.64)** |");
    expect(Number((38.85 / (1 - 0.01 - 0.0015 - 0.1)).toFixed(2))).toBe(43.73);
    expect(k3).toContain("| **FOB** | 75.99 ÷ 0.8885 | **85.53 (পিসে 7.13)** |");
    expect(Number((75.99 / 0.8885).toFixed(2))).toBe(85.53);
    // The hoodie order: 300 dozen at 85.5262, and the owner's 10% of it.
    expect(k3).toContain("পুরো অর্ডারে FOB 25,658 USD, লাভ (মালিকের 10%) 2,566।");
    expect(Math.round((300 * 75.99) / 0.8885)).toBe(25_658);
  });

  it("tests Mehedi on the same rules, with no note that the book says otherwise", () => {
    const k3Tests = tests.K3!.questions;
    expect(k3Tests).toHaveLength(12);
    for (const q of k3Tests) {
      expect(q.v62, `question ${q.n}`).toBeUndefined();
      expect(q.expected, `question ${q.n}`).not.toMatch(/0\.9085|rate\/min|70\/55|floor নেই/);
      expect(q.q, `question ${q.n}`).not.toMatch(/লাভ 8%|মালিকের 8%/);
    }
  });
});
