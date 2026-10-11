import { type CostAllocationMethod, Prisma, type StockGrade } from "@prisma/client";

import { AppError } from "@/lib/errors";

/*
 * Batch costing for "Move to Stock". A project's costs (bills, direct costs)
 * collect in work-in-progress; each factory delivery moves its share into stock,
 * split across the received pieces, with B-grade pieces optionally valued lower.
 */

type Num = Prisma.Decimal | number | string;
const dec = (v: Num) => new Prisma.Decimal(v);
export const money = (v: Num) => dec(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
/** Cost per piece keeps 4 decimals, like ProductVariant.avgCost. */
const perPiece = (v: Num) => dec(v).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
export const ZERO = new Prisma.Decimal(0);

/** A B-grade piece carries half the cost of an A-grade one unless told otherwise. */
export const DEFAULT_B_GRADE_RATIO = 0.5;

/**
 * The share of a project's remaining cost that one delivery takes. Pieces are
 * costed against what is still expected: 300 pieces when 1,000 are still due
 * take 30% of the remaining cost. The last delivery, or one that reaches the
 * target quantity, takes all of it.
 */
export function deliveryCostShare(args: {
  wip: Num;
  pieces: number;
  received: number;
  target: number;
  final: boolean;
}): Prisma.Decimal {
  const wip = money(args.wip);
  if (wip.lte(0) || args.pieces <= 0) return ZERO;
  const outstanding = args.target - args.received;
  if (args.final || args.pieces >= outstanding) return wip;
  return money(wip.times(args.pieces).dividedBy(outstanding));
}

export type CostingLine = { grade: StockGrade; quantity: number; unitCost?: Num | null };

/** Cost per piece for each line, so that the lines add up to `total`. */
export function allocateIntakeCost(
  lines: CostingLine[],
  method: CostAllocationMethod,
  total: Num,
  bGradeRatio: Num = DEFAULT_B_GRADE_RATIO,
): Prisma.Decimal[] {
  if (method === "MANUAL") {
    return lines.map((line, i) => {
      if (line.unitCost === undefined || line.unitCost === null) {
        throw new AppError("VALIDATION", "Enter the cost per piece on every line.", {
          [`lines.${i}.unitCost`]: ["Required for manual costing"],
        });
      }
      return perPiece(line.unitCost);
    });
  }
  const amount = money(total);
  const weight = (line: CostingLine) =>
    method === "B_GRADE_RATIO" && line.grade === "B_GRADE" ? dec(bGradeRatio) : dec(1);
  const units = lines.reduce((s, l) => s.plus(weight(l).times(l.quantity)), ZERO);
  if (units.isZero()) {
    if (amount.isZero()) return lines.map(() => ZERO);
    throw new AppError(
      "VALIDATION",
      "With B-grade valued at 0, only A-grade pieces can carry the cost. Add A-grade pieces or change the ratio.",
    );
  }
  const costPerUnit = amount.dividedBy(units);
  return lines.map((line) => perPiece(costPerUnit.times(weight(line))));
}

/**
 * What a delivery moves into stock: the total cost and the cost per piece of
 * each line. With MANUAL costing the total is what the entered costs add up to.
 */
export function planIntakeCost(args: {
  lines: CostingLine[];
  method: CostAllocationMethod;
  bGradeRatio?: Num | null;
  wip: Num;
  received: number;
  target: number;
  final: boolean;
  totalOverride?: Num;
}) {
  const pieces = args.lines.reduce((s, l) => s + l.quantity, 0);
  const wip = money(args.wip);
  let total: Prisma.Decimal;
  let unitCosts: Prisma.Decimal[];
  if (args.method === "MANUAL") {
    unitCosts = allocateIntakeCost(args.lines, "MANUAL", 0);
    total = money(args.lines.reduce((s, l, i) => s.plus(unitCosts[i]!.times(l.quantity)), ZERO));
  } else {
    total =
      args.totalOverride !== undefined
        ? money(args.totalOverride)
        : deliveryCostShare({
            wip,
            pieces,
            received: args.received,
            target: args.target,
            final: args.final,
          });
    unitCosts = allocateIntakeCost(
      args.lines,
      args.method,
      total,
      args.bGradeRatio ?? DEFAULT_B_GRADE_RATIO,
    );
  }
  return {
    pieces,
    total,
    unitCosts,
    exceedsRemaining: total.gt(wip),
    remainingAfter: wip.minus(total),
  };
}

/**
 * "Into the received pieces": when a project is completed, all that its
 * deliveries carried into stock is spread again over every piece received, the
 * way its last delivery split cost (equal per piece, or B-grade at its share).
 * Each piece then costs the same whichever delivery brought it, and pieces
 * short of the target carry no cost of their own. Returns each line's cost per
 * piece and the value it gains (or gives up) against the cost it came in at;
 * null when the last delivery's costs were typed per piece (manual), which are
 * kept, or the split cannot be made.
 */
export function evenOutPieceCost(args: {
  lines: Array<{ grade: StockGrade; quantity: number; unitCost: Num }>;
  method: CostAllocationMethod;
  bGradeRatio?: Num | null;
}) {
  if (args.method === "MANUAL" || args.lines.length === 0) return null;
  const total = money(args.lines.reduce((s, l) => s.plus(dec(l.unitCost).times(l.quantity)), ZERO));
  let unitCosts: Prisma.Decimal[];
  try {
    unitCosts = allocateIntakeCost(
      args.lines,
      args.method,
      total,
      args.bGradeRatio ?? DEFAULT_B_GRADE_RATIO,
    );
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
  const costOf = (grade: StockGrade) => {
    const i = args.lines.findIndex((l) => l.grade === grade && l.quantity > 0);
    return i < 0 ? null : unitCosts[i]!;
  };
  return {
    total,
    pieces: args.lines.reduce((s, l) => s + l.quantity, 0),
    perPiece: { a: costOf("A_GRADE"), b: costOf("B_GRADE") },
    unitCosts,
    adjustments: args.lines.map((l, i) =>
      unitCosts[i]!.minus(dec(l.unitCost))
        .times(l.quantity)
        .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
    ),
  };
}

/**
 * What a piece of each grade would cost once evened out: `total` over the A-
 * and B-grade pieces, split as `method` splits it (null for manual costing, or
 * with no pieces).
 */
export function evenCostPerPiece(args: {
  aPieces: number;
  bPieces: number;
  total: Num;
  method: CostAllocationMethod;
  bGradeRatio?: Num | null;
}) {
  const lines = [
    { grade: "A_GRADE" as const, quantity: args.aPieces },
    { grade: "B_GRADE" as const, quantity: args.bPieces },
  ].filter((l) => l.quantity > 0);
  if (args.method === "MANUAL" || lines.length === 0) return null;
  try {
    const costs = allocateIntakeCost(
      lines,
      args.method,
      args.total,
      args.bGradeRatio ?? DEFAULT_B_GRADE_RATIO,
    );
    return {
      a: args.aPieces > 0 ? costs[0]! : null,
      b: args.bPieces > 0 ? costs[lines.length - 1]! : null,
    };
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}

/**
 * How much of a change in a SKU grade's value lands on pieces still in stock,
 * the rest having gone with pieces already sold. The newest pieces are taken
 * to be the ones left: of `onHand` pieces, the latest delivery's count first.
 * `lines` are newest first.
 */
export function inStockShare(
  lines: ReadonlyArray<{ quantity: number; change: Num }>,
  onHand: number,
): Prisma.Decimal {
  let left = Math.max(onHand, 0);
  let share = ZERO;
  for (const line of lines) {
    if (left <= 0) break;
    if (line.quantity <= 0) continue;
    const kept = Math.min(line.quantity, left);
    left -= kept;
    share = share.plus(dec(line.change).times(kept).dividedBy(line.quantity));
  }
  return share;
}
