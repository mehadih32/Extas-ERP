import { Prisma, type StockGrade } from "@prisma/client";

import type { Db } from "@/lib/db-types";

/*
 * Each SKU keeps one weighted average cost per grade: `avgCost` for its A-grade
 * pieces (the sellable ones: cost of goods sold) and `bGradeAvgCost` for its
 * B-grade pieces. Pieces coming in re-weight only their own grade's average and
 * pieces going out leave at it, so B-grade pieces valued lower at Move to Stock
 * never lower the cost of the A-grade ones (and the other way round).
 */

const ZERO = new Prisma.Decimal(0);

export type GradeCosts = { avgCost: Prisma.Decimal; bGradeAvgCost: Prisma.Decimal };

/** The average cost of one grade of a SKU. */
export function gradeCost(variant: GradeCosts, grade: StockGrade): Prisma.Decimal {
  return grade === "B_GRADE" ? variant.bGradeAvgCost : variant.avgCost;
}

/** Update data setting one grade's average cost (4 decimals, like the column). */
export function gradeCostData(grade: StockGrade, cost: Prisma.Decimal.Value) {
  const value = new Prisma.Decimal(cost).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  return grade === "B_GRADE" ? { bGradeAvgCost: value } : { avgCost: value };
}

/** SQL for the cost of a stock balance's pieces, with the balance as `sb` and its SKU as `pv`. */
export const balanceUnitCostSql = Prisma.sql`CASE WHEN sb.grade = 'B_GRADE'::"StockGrade" THEN pv."bGradeAvgCost" ELSE pv."avgCost" END`;

export const gradeKey = (variantId: string, grade: StockGrade) => `${variantId}:${grade}`;

/** Pieces on hand per SKU and grade across every warehouse, keyed by `gradeKey`. */
export async function onHandByGrade(db: Db, variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await db.stockBalance.groupBy({
    by: ["variantId", "grade"],
    where: { variantId: { in: variantIds } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [gradeKey(r.variantId, r.grade), r._sum.quantity ?? 0]));
}

/**
 * Takes back out `quantity` pieces that came in at `unitCost` from a SKU grade
 * holding `onHand` pieces at `average`, the reverse of re-weighting the average
 * when they came in. Returns the average the pieces left keep and the value
 * that leaves with the pieces taken out.
 *
 * Usually that value is quantity x unitCost and the rest get back the average
 * they had before. When stock at other costs came and went in between, the
 * grade may hold less value than that: then all of its value leaves and the
 * rest are left at cost 0. When no pieces are left, all the value leaves and
 * the average stays as the cost of the last pieces held.
 */
export function removeAtCost(
  onHand: number,
  average: Prisma.Decimal.Value,
  quantity: number,
  unitCost: Prisma.Decimal.Value,
): { average: Prisma.Decimal; removed: Prisma.Decimal } {
  const current = new Prisma.Decimal(average);
  const value = current.times(Math.max(onHand, 0));
  const left = onHand - quantity;
  if (left <= 0) return { average: current, removed: value };
  const out = new Prisma.Decimal(unitCost).times(quantity);
  const rest = value.minus(out);
  if (rest.isNegative()) return { average: ZERO, removed: value };
  return {
    average: rest.dividedBy(left).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
    removed: out,
  };
}
