import { describe, expect, it } from "vitest";

import {
  type ContractFacts,
  parseClauses,
  readClauses,
  ruleClauses,
} from "@/modules/production/contract-terms";

const facts = (over: Partial<ContractFacts> = {}): ContractFacts => ({
  kind: "FABRIC",
  company: "Extas Apparel Ltd",
  party: "Narayanganj Fabrics",
  batch: { code: "MB-2026-00001", name: "Winter 2026" },
  dueOn: "15 Nov 2026",
  pricesLater: false,
  materials: ["Single Jersey (kg)"],
  styles: [],
  cmAgreed: true,
  ...over,
});

describe("contract clauses drafted by rule", () => {
  it("drafts a fabric agreement with weighing, Short/Extra, faults and the day", () => {
    const clauses = ruleClauses(facts());
    expect(clauses.map((c) => c.title)).toEqual([
      "What is bought",
      "Quality",
      "Delivery",
      "Weighing and Short/Extra",
      "Fabric faults",
      "Price and payment",
      "Disagreements",
    ]);
    const text = clauses.map((c) => c.text).join(" ");
    expect(text).toContain("Narayanganj Fabrics supplies the fabric");
    expect(text).toContain('MB-2026-00001 "Winter 2026" (Single Jersey (kg))');
    expect(text).toContain("by 15 Nov 2026");
    expect(text).toContain("Final Match");
    expect(text).toContain("Supplier Due");
    expect(text).not.toMatch(/variance|reconcil|inventory|accounts payable/i);
    expect(text).not.toContain("At receive");
  });

  it("says when prices are agreed at receive, and words the days without one", () => {
    const text = ruleClauses(facts({ pricesLater: true, dueOn: null }))
      .map((c) => c.text)
      .join(" ");
    expect(text).toContain("'At receive'");
    expect(text).toContain("on the days on the purchase orders");
  });

  it("drafts accessories on a continuous ledger and the factory with grades and deductions", () => {
    const acc = ruleClauses(facts({ kind: "ACCESSORIES", party: "Dhaka Trims" }));
    expect(acc.find((c) => c.title === "Price and payment")!.text).toMatch(/continuous ledger/);
    expect(acc.find((c) => c.title === "Approved samples")).toBeDefined();
    const cm = ruleClauses(facts({ kind: "FACTORY_CM", party: "Gazipur Knit", cmAgreed: false }));
    expect(cm.map((c) => c.title)).toEqual([
      "What is made",
      "Materials",
      "Cutting and dates",
      "Quality and grading",
      "Deductions",
      "Payment",
      "Disagreements",
    ]);
    expect(cm[0]!.text).toMatch(/agreed in writing before cutting/);
    expect(cm.find((c) => c.title === "Payment")!.text).toMatch(
      /Total CM less deductions less advance is the final payable/,
    );
  });
});

describe("reading clauses", () => {
  const four = [1, 2, 3, 4].map((n) => ({ title: `T${n}`, text: `Text ${n}` }));

  it("takes a JSON array of titled clauses, even with words around it", () => {
    expect(parseClauses(`Here you are:\n${JSON.stringify(four)}\nDone.`)).toEqual(four);
  });

  it("refuses answers it cannot use", () => {
    expect(parseClauses("no json here")).toBeNull();
    expect(parseClauses("[not json]")).toBeNull();
    expect(parseClauses(JSON.stringify(four.slice(0, 3)))).toBeNull();
    expect(parseClauses(JSON.stringify([...four, { title: "", text: "x" }]))).toBeNull();
    expect(
      parseClauses(JSON.stringify([...four, { title: "x".repeat(81), text: "x" }])),
    ).toBeNull();
    expect(parseClauses(JSON.stringify([...four, { title: "x", text: 5 }]))).toBeNull();
  });

  it("reads stored clauses, skipping anything malformed", () => {
    expect(readClauses([{ title: "A", text: "B" }, { title: "C" }, null, "x"])).toEqual([
      { title: "A", text: "B" },
    ]);
    expect(readClauses({})).toEqual([]);
  });
});
