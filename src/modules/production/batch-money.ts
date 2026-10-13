import { Prisma } from "@prisma/client";

import { money, ZERO } from "@/modules/production/costing";

/*
 * The money of a master batch as plain sums: a cost split equally among its
 * styles (Cost Setup), and the final CM settlement with its factory:
 *   Total CM - Deductions - Advance taken = Final payable.
 */

type Num = Prisma.Decimal | number | string;

/**
 * An amount split equally to the cent among `count` shares, the cents left
 * over going one each to the first shares: 100.00 in 3 is 33.34, 33.33, 33.33.
 */
export function splitEqually(amount: Num, count: number): Prisma.Decimal[] {
  if (count <= 0) return [];
  const cents = money(amount).times(100).toNumber();
  const each = Math.floor(cents / count);
  const extra = cents - each * count;
  return Array.from({ length: count }, (_, i) =>
    new Prisma.Decimal(each + (i < extra ? 1 : 0)).dividedBy(100),
  );
}

/** One style's pieces and CM on the settlement. */
export type CmStyleLine = {
  cmRate: Prisma.Decimal | null;
  a: number;
  b: number;
  c: number;
  reject: number;
};

/** The pieces the factory is paid CM for: every piece it made and handed over (A, B, C, rejects). */
export const cmPieces = (s: CmStyleLine) => s.a + s.b + s.c + s.reject;

/**
 * The reject rule of a style: rejects (sewing faults, bodies ruined attaching
 * accessories) up to `percent` of the pieces cut cost the factory nothing; each
 * one over that is charged at `rate` (the style's target price). The allowance
 * is in whole pieces, rounded down: 2% of 1,010 cut is 20 pieces.
 */
export function rejectPenalty(args: {
  cut: number;
  rejects: number;
  percent: Num;
  rate: Num | null;
}) {
  const allowance = new Prisma.Decimal(args.cut)
    .times(args.percent)
    .dividedBy(100)
    .floor()
    .toNumber();
  const over = Math.max(args.rejects - allowance, 0);
  return {
    allowance,
    over,
    penalty:
      args.rate !== null && over > 0 ? money(new Prisma.Decimal(args.rate).times(over)) : ZERO,
  };
}

/**
 * Total CM - Deductions - Advance taken = Final payable. Deductions are the
 * factory's open faults with a value (missing pieces, fabric faults...), the
 * rejects over the batch's allowance at the styles' target price and, when
 * chosen, the CM of the C-grade pieces. The payable can go below zero when the
 * factory took more than it earned: it then owes the difference.
 */
export function cmSettlementMath(args: {
  styles: CmStyleLine[];
  faults: Num[];
  /** Each style's charge for its rejects over the allowance. */
  rejectPenalties?: Num[];
  deductCGrade: boolean;
  paid: Num;
}) {
  const totalCm = args.styles.reduce(
    (t, s) => (s.cmRate ? t.plus(money(s.cmRate.times(cmPieces(s)))) : t),
    ZERO,
  );
  const cGradeCm = args.styles.reduce(
    (t, s) => (s.cmRate ? t.plus(money(s.cmRate.times(s.c))) : t),
    ZERO,
  );
  const faults = args.faults.reduce<Prisma.Decimal>((t, f) => t.plus(money(f)), ZERO);
  const rejects = (args.rejectPenalties ?? []).reduce<Prisma.Decimal>(
    (t, p) => t.plus(money(p)),
    ZERO,
  );
  const deductions = faults.plus(rejects).plus(args.deductCGrade ? cGradeCm : ZERO);
  const paid = money(args.paid);
  return {
    totalCm,
    cGradeCm,
    faults,
    rejects,
    deductions,
    paid,
    payable: totalCm.minus(deductions).minus(paid),
  };
}
