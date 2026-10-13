import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  cmPieces,
  cmSettlementMath,
  rejectPenalty,
  splitEqually,
} from "@/modules/production/batch-money";

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

describe("rejectPenalty", () => {
  it("lets rejects up to the allowance go and charges the rest at the target price", () => {
    // 2% of 1,010 cut is 20.2: 20 pieces.
    const within = rejectPenalty({ cut: 1010, rejects: 20, percent: 2, rate: "480" });
    expect([within.allowance, within.over, within.penalty.toFixed(2)]).toEqual([20, 0, "0.00"]);
    const over = rejectPenalty({ cut: 1010, rejects: 30, percent: "2.00", rate: "480" });
    expect([over.allowance, over.over, over.penalty.toFixed(2)]).toEqual([20, 10, "4800.00"]);
    // 3% of 1,010 is 30.3: 30 pieces.
    expect(rejectPenalty({ cut: 1010, rejects: 30, percent: 3, rate: 480 }).over).toBe(0);
    expect(rejectPenalty({ cut: 1000, rejects: 5, percent: 0, rate: 450 }).penalty.toFixed(2)).toBe(
      "2250.00",
    );
  });

  it("charges nothing without a target price", () => {
    const none = rejectPenalty({ cut: 100, rejects: 9, percent: 2, rate: null });
    expect([none.allowance, none.over, none.penalty.toFixed(2)]).toEqual([2, 7, "0.00"]);
  });

  it("adds the reject charges to the deductions", () => {
    const m = cmSettlementMath({
      styles: [{ cmRate: new Prisma.Decimal(90), a: 90, b: 5, c: 0, reject: 5 }],
      faults: ["100"],
      rejectPenalties: ["1440"],
      deductCGrade: false,
      paid: 0,
    });
    expect([m.totalCm, m.rejects, m.deductions, m.payable].map((v) => v.toFixed(2))).toEqual([
      "9000.00",
      "1440.00",
      "1540.00",
      "7460.00",
    ]);
  });
});
