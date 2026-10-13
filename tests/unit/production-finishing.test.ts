import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  addUpGrades,
  finalUnitCost,
  finishingCell,
  linePieces,
  NO_GRADES,
  readGradeLines,
} from "@/modules/production/finishing";

/*
 * Finishing in plain numbers: grades added up by colour and size (mending
 * moving pieces out of C), each cell's A and B against what is in stock, what
 * is left to count, and the final unit cost, total ÷ (A + B).
 */

const line = (sizeName: string, g: Partial<typeof NO_GRADES>) => ({
  colorName: "Navy",
  sizeName,
  ...NO_GRADES,
  ...g,
});

describe("finishing grades", () => {
  it("adds up counts and mending returns by cell", () => {
    const total = addUpGrades([
      [line("S", { a: 6, b: 2, c: 3 }), line("M", { a: 7, reject: 1 })],
      // Back from mending: two C pieces became A, one a reject.
      [line("S", { a: 2, c: -3, reject: 1 })],
    ]);
    expect(total.get("Navy|S")).toEqual({ a: 8, b: 2, c: 0, reject: 1, missing: 0 });
    expect(total.get("Navy|M")).toEqual({ a: 7, b: 0, c: 0, reject: 1, missing: 0 });
    expect(linePieces(total.get("Navy|S")!)).toBe(11);
  });

  it("reads stored lines back and skips a broken row", () => {
    expect(
      readGradeLines([{ colorName: null, sizeName: null, a: 1, b: 0, c: 0, reject: 0 }]),
    ).toEqual([{ colorName: null, sizeName: null, a: 1, b: 0, c: 0, reject: 0, missing: 0 }]);
    expect(readGradeLines([{ a: "x" }])).toEqual([]);
    expect(readGradeLines(null)).toEqual([]);
  });

  it("works out a cell: to stock, left to count, and what more in stock than counted means", () => {
    const cell = finishingCell({
      counted: { a: 6, b: 2, c: 1, reject: 0, missing: 0 },
      inStock: { a: 4, b: 0 },
      cut: { good: 12, out: 1 },
    });
    expect(cell).toMatchObject({
      a: 6,
      b: 2,
      toStock: { a: 2, b: 2 },
      accounted: 9,
      free: 2,
      notCounted: 2,
    });
    // Received on a delivery without a count: the stock is what was graded.
    const received = finishingCell({
      counted: { a: 0, b: 0, c: 0, reject: 0, missing: 0 },
      inStock: { a: 5, b: 1 },
      cut: null,
    });
    expect(received).toMatchObject({
      a: 5,
      b: 1,
      toStock: { a: 0, b: 0 },
      free: null,
      notCounted: null,
    });
    // More counted than cut and back shows as no room left, never below zero not counted.
    expect(
      finishingCell({
        counted: { ...NO_GRADES, a: 5 },
        inStock: { a: 0, b: 0 },
        cut: { good: 4, out: 0 },
      }),
    ).toMatchObject({ free: -1, notCounted: 0 });
  });

  it("puts the whole cost on the A and B pieces", () => {
    expect(finalUnitCost(new Prisma.Decimal(1800), 16)?.toFixed(2)).toBe("112.50");
    expect(finalUnitCost(new Prisma.Decimal(1000), 3)?.toFixed(2)).toBe("333.33");
    expect(finalUnitCost(new Prisma.Decimal(500), 0)).toBeNull();
  });
});
