import { Prisma } from "@prisma/client";
import { z } from "zod";

import { money } from "./costing";
import { cellKey } from "./cutting";

/*
 * Finishing and QC, worked out in plain numbers so the screens, the packing
 * list and the tests agree. Pieces are graded A, B or C (mending) at
 * finishing, with rejects (sewing faults) kept apart; mended pieces come back
 * as A, B or reject; and the full packing list records what is missing (lost
 * or stolen). Only A and B pieces go to stock, and they carry the whole cost
 * of the style: final unit cost = total cost ÷ (A + B).
 */

const pieces = z.number().int().min(0).max(1_000_000);
const cellName = {
  colorName: z.string().trim().min(1).max(60).nullish(),
  sizeName: z.string().trim().min(1).max(30).nullish(),
};

/** One cell of a finishing count. */
export const countLineSchema = z.object({
  ...cellName,
  a: pieces,
  b: pieces,
  c: pieces,
  reject: pieces,
});

/** One cell back from mending: the C pieces that came back as A, B or reject. */
export const mendingLineSchema = z.object({ ...cellName, a: pieces, b: pieces, reject: pieces });

/** One cell's missing pieces on the full packing list. */
export const missingLineSchema = z.object({ ...cellName, quantity: pieces });

/** A stored line: c is negative on a mending return (pieces moved out of mending). */
const storedLineSchema = z.object({
  colorName: z.string().nullish(),
  sizeName: z.string().nullish(),
  a: z.number().int(),
  b: z.number().int(),
  c: z.number().int(),
  reject: z.number().int(),
  missing: z.number().int().default(0),
});

export type GradeLine = {
  colorName: string | null;
  sizeName: string | null;
  a: number;
  b: number;
  c: number;
  reject: number;
  missing: number;
};

export type Grades = Pick<GradeLine, "a" | "b" | "c" | "reject" | "missing">;

export const NO_GRADES: Grades = { a: 0, b: 0, c: 0, reject: 0, missing: 0 };

/** Reads stored lines back (a row written by an older shape is skipped, never thrown on). */
export function readGradeLines(value: unknown): GradeLine[] {
  const parsed = z.array(storedLineSchema).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.map((l) => ({
    ...l,
    colorName: l.colorName ?? null,
    sizeName: l.sizeName ?? null,
  }));
}

/** Pieces counted in a list of lines (every grade, rejects and missing). */
export const linePieces = (l: Grades) => l.a + l.b + l.c + l.reject + l.missing;

/** Grades by cell, added up over several lists of lines. */
export function addUpGrades(lists: ReadonlyArray<ReadonlyArray<GradeLine>>) {
  const total = new Map<string, Grades>();
  for (const lines of lists) {
    for (const l of lines) {
      const key = cellKey(l.colorName, l.sizeName);
      const was = total.get(key) ?? NO_GRADES;
      total.set(key, {
        a: was.a + l.a,
        b: was.b + l.b,
        c: was.c + l.c,
        reject: was.reject + l.reject,
        missing: was.missing + l.missing,
      });
    }
  }
  return total;
}

export type FinishingCellInput = {
  /** Graded at finishing (counts and mending, net) and missing on the packing list. */
  counted: Grades;
  /** A and B pieces of the cell already in stock (confirmed deliveries). */
  inStock: { a: number; b: number };
  /** Pieces cut and good (spoiled ones taken off), and those still out for embroidery or print. */
  cut: { good: number; out: number } | null;
};

/**
 * One colour and size at finishing. A and B are what was graded, or what is
 * in stock when more was received on a delivery than counted; "to stock" is
 * what is graded and not yet in stock. "Not counted" is what was cut and is
 * back from embroidery but not graded, missing or rejected yet (null when no
 * cutting was recorded): on the full packing list it is what is missing.
 */
export function finishingCell({ counted, inStock, cut }: FinishingCellInput) {
  const a = Math.max(counted.a, inStock.a);
  const b = Math.max(counted.b, inStock.b);
  const accounted = a + b + counted.c + counted.reject + counted.missing;
  return {
    a,
    b,
    c: counted.c,
    reject: counted.reject,
    missing: counted.missing,
    inStock,
    toStock: { a: a - inStock.a, b: b - inStock.b },
    accounted,
    /** Pieces that may still be counted (null: no cutting recorded, so no limit known). */
    free: cut ? cut.good - cut.out - accounted : null,
    notCounted: cut ? Math.max(cut.good - cut.out - accounted, 0) : null,
  };
}

export type FinishingCell = ReturnType<typeof finishingCell>;

/**
 * Final unit cost: the style's total cost over its A and B pieces, since C
 * pieces, rejects and missing pieces never reach stock. Null with no A or B
 * pieces yet.
 */
export function finalUnitCost(totalCost: Prisma.Decimal, goodPieces: number) {
  return goodPieces > 0 ? money(totalCost.dividedBy(goodPieces)) : null;
}
