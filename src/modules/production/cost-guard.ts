import { Prisma } from "@prisma/client";

/*
 * The cost guard: a project's live cost per piece (cost so far ÷ pieces to make)
 * against its target price. Below 85% of the target it is fine, from 85% it is
 * close (yellow) and from 100% it is over (red). Pure, so the screens, the
 * alerts and the tests read it the same way.
 */

export type CostGuardLevel = "OK" | "NEAR" | "OVER";

/** From this share of the target price on, the guard turns yellow. */
export const COST_GUARD_NEAR = 0.85;

const RANK: Record<CostGuardLevel, number> = { OK: 0, NEAR: 1, OVER: 2 };

export type CostGuard = {
  level: CostGuardLevel;
  /** Cost so far ÷ pieces to make, to 2 decimals. */
  perPiece: Prisma.Decimal;
  target: Prisma.Decimal;
  /** perPiece as a whole percent of the target (can pass 100). */
  percent: number;
  /** What is still left to spend per piece before the target is reached (0 once over). */
  leftPerPiece: Prisma.Decimal;
};

type Amount = Prisma.Decimal | number | string;

/** The guard for a project; null when it has no target price or nothing to make. */
export function costGuard(
  totalCost: Amount,
  targetQuantity: number,
  targetUnitCost: Amount | null | undefined,
): CostGuard | null {
  if (targetUnitCost === null || targetUnitCost === undefined || targetQuantity <= 0) return null;
  const target = new Prisma.Decimal(targetUnitCost);
  if (target.lte(0)) return null;
  const perPiece = new Prisma.Decimal(totalCost)
    .dividedBy(targetQuantity)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const share = perPiece.dividedBy(target);
  const level = levelOf(share);
  const left = target.minus(perPiece);
  return {
    level,
    perPiece,
    target,
    percent: share.times(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN).toNumber(),
    leftPerPiece: left.gt(0) ? left : new Prisma.Decimal(0),
  };
}

/** Whether the guard got worse (fine to close, close to over, fine to over). */
export function guardWorsened(before: CostGuardLevel | null, after: CostGuardLevel | null) {
  if (!after) return false;
  return RANK[after] > RANK[before ?? "OK"];
}

/** The level for a share of the target (0.9 = 90% of it). */
function levelOf(share: Prisma.Decimal): CostGuardLevel {
  return share.gte(1) ? "OVER" : share.gte(COST_GUARD_NEAR) ? "NEAR" : "OK";
}

/**
 * A batch's guard over the styles that have a target price: their cost so far
 * against what their pieces may cost in all (Σ target price × pieces). Null when
 * no style has a target price.
 */
export function batchCostGuard(
  styles: ReadonlyArray<{
    totalCost: Amount;
    targetQuantity: number;
    targetUnitCost: Amount | null | undefined;
  }>,
) {
  let budget = new Prisma.Decimal(0);
  let spent = new Prisma.Decimal(0);
  let guarded = 0;
  for (const s of styles) {
    if (!costGuard(s.totalCost, s.targetQuantity, s.targetUnitCost)) continue;
    guarded += 1;
    budget = budget.plus(new Prisma.Decimal(s.targetUnitCost!).times(s.targetQuantity));
    spent = spent.plus(new Prisma.Decimal(s.totalCost));
  }
  if (guarded === 0 || budget.lte(0)) return null;
  const share = spent.dividedBy(budget);
  const left = budget.minus(spent);
  return {
    level: levelOf(share),
    percent: share.times(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN).toNumber(),
    /** What the guarded styles may cost in all, and what they cost so far. */
    budget,
    spent,
    left: left.gt(0) ? left : new Prisma.Decimal(0),
    /** How many styles have a target price. */
    styles: guarded,
  };
}

/** "Near the target price" / "Over the target price": the alert's subject. */
export function guardHeadline(level: CostGuardLevel) {
  return level === "OVER" ? "Over the target price" : "Near the target price";
}
