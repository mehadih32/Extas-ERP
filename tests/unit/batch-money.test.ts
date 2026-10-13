import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { cmPieces, cmSettlementMath, splitEqually } from "@/modules/production/batch-money";

describe("splitEqually", () => {
  it("splits to the cent, the odd cents to the first shares", () => {
    expect(splitEqually(100, 3).map((s) => s.toFixed(2))).toEqual(["33.34", "33.33", "33.33"]);
    expect(splitEqually("100.01", 2).map((s) => s.toFixed(2))).toEqual(["50.01", "50.00"]);
    expect(splitEqually(90, 1).map((s) => s.toFixed(2))).toEqual(["90.00"]);
    expect(splitEqually(0.01, 2).map((s) => s.toFixed(2))).toEqual(["0.01", "0.00"]);
    expect(splitEqually(10, 0)).toEqual([]);
  });

  it("always adds back up to the amount", () => {
    for (const [amount, count] of [
      [1234.57, 7],
      [0.05, 3],
      [999999.99, 13],
    ] as const) {
      const total = splitEqually(amount, count).reduce((t, s) => t.plus(s), new Prisma.Decimal(0));
      expect(total.toFixed(2)).toBe(amount.toFixed(2));
    }
  });
});

describe("cmSettlementMath", () => {
  const rate = new Prisma.Decimal(90);
  const styles = [
    { cmRate: rate, a: 13, b: 3, c: 1, reject: 1 },
    { cmRate: null, a: 0, b: 0, c: 0, reject: 0 },
  ];

  it("pays CM on A, B, C and rejects", () => {
    expect(cmPieces(styles[0]!)).toBe(18);
  });

  it("is Total CM - Deductions - Advance taken, with the C-grade CM only when chosen", () => {
    const keep = cmSettlementMath({
      styles,
      faults: ["225", "100"],
      deductCGrade: false,
      paid: 500,
    });
    expect(
      [keep.totalCm, keep.cGradeCm, keep.deductions, keep.payable].map((v) => v.toFixed(2)),
    ).toEqual(["1620.00", "90.00", "325.00", "795.00"]);
    const take = cmSettlementMath({
      styles,
      faults: ["225", "100"],
      deductCGrade: true,
      paid: 500,
    });
    expect([take.deductions, take.payable].map((v) => v.toFixed(2))).toEqual(["415.00", "705.00"]);
  });

  it("goes below zero when the factory took more than it earned", () => {
    const over = cmSettlementMath({ styles, faults: [], deductCGrade: false, paid: 2000 });
    expect(over.payable.toFixed(2)).toBe("-380.00");
  });
});
