import { type MaterialSplit, type MeasurementUnit, Prisma } from "@prisma/client";

import { WHOLE_UNITS } from "@/modules/materials/valuation";

/*
 * What a style's "Materials per piece" come to: each need (per piece, plus the
 * wastage on top) times the pieces to make, in one total, per garment colour
 * (fabric) or per colour and size (collars, cuffs). Whole units (pieces, rolls,
 * cones, sets) round up to the next whole one, the rest to 3 decimals, always
 * up, so the order never falls short. Pure, so the screens, the orders and the
 * tests work it out the same way.
 */

type Amount = Prisma.Decimal | number | string;

/** A cell of the style's grid: pieces to make of one colour and size. */
export type GridCell = { colorName: string; sizeName: string; quantity: number };

export type NeedPart = {
  /** null: every colour (a total, or a style without a grid). */
  colorName: string | null;
  sizeName: string | null;
  /** Pieces of the garment this part is for. */
  pieces: number;
  quantity: Prisma.Decimal;
};

/** Rounds a quantity up to what can be ordered in the unit. */
export function roundUpFor(unit: MeasurementUnit, value: Prisma.Decimal): Prisma.Decimal {
  return WHOLE_UNITS.includes(unit)
    ? value.toDecimalPlaces(0, Prisma.Decimal.ROUND_UP)
    : value.toDecimalPlaces(3, Prisma.Decimal.ROUND_UP);
}

/** perPiece × pieces, plus the wastage percent, rounded up for the unit. */
export function needFor(
  need: { perPiece: Amount; wastagePercent: Amount },
  unit: MeasurementUnit,
  pieces: number,
): Prisma.Decimal {
  if (pieces <= 0) return new Prisma.Decimal(0);
  const base = new Prisma.Decimal(need.perPiece).times(pieces);
  const withWaste = base.times(new Prisma.Decimal(100).plus(need.wastagePercent)).dividedBy(100);
  return roundUpFor(unit, withWaste);
}

/**
 * A need over a style's pieces: one part, a part per colour or a part per
 * colour and size (each rounded up on its own), and their total. A style with
 * no grid has only its total pieces, so it gets one part whatever the split.
 */
export function planNeed(
  need: { perPiece: Amount; wastagePercent: Amount; split: MaterialSplit },
  unit: MeasurementUnit,
  grid: readonly GridCell[],
  totalPieces: number,
) {
  let parts: NeedPart[];
  const cells = grid.filter((c) => c.quantity > 0);
  if (need.split === "TOTAL" || cells.length === 0) {
    parts = [
      {
        colorName: null,
        sizeName: null,
        pieces: totalPieces,
        quantity: needFor(need, unit, totalPieces),
      },
    ];
  } else if (need.split === "COLOUR") {
    const byColour = new Map<string, number>();
    for (const c of cells) byColour.set(c.colorName, (byColour.get(c.colorName) ?? 0) + c.quantity);
    parts = [...byColour].map(([colorName, pieces]) => ({
      colorName,
      sizeName: null,
      pieces,
      quantity: needFor(need, unit, pieces),
    }));
  } else {
    parts = cells.map((c) => ({
      colorName: c.colorName,
      sizeName: c.sizeName,
      pieces: c.quantity,
      quantity: needFor(need, unit, c.quantity),
    }));
  }
  return {
    parts,
    total: parts.reduce((sum, p) => sum.plus(p.quantity), new Prisma.Decimal(0)),
  };
}

/**
 * Splits an ordered quantity over the parts it was planned from, in proportion,
 * so a line ordered at a different quantity still has its style-wise breakdown.
 * The last part takes what rounding leaves, so the shares add up exactly.
 */
export function shareOut<T extends { quantity: Prisma.Decimal }>(
  ordered: Prisma.Decimal,
  parts: readonly T[],
  unit: MeasurementUnit,
): Array<T & { share: Prisma.Decimal }> {
  const planned = parts.reduce((sum, p) => sum.plus(p.quantity), new Prisma.Decimal(0));
  if (parts.length === 0) return [];
  if (planned.lte(0)) {
    return parts.map((p, i) => ({ ...p, share: i === 0 ? ordered : new Prisma.Decimal(0) }));
  }
  const places = WHOLE_UNITS.includes(unit) ? 0 : 3;
  let left = ordered;
  return parts.map((p, i) => {
    const share =
      i === parts.length - 1
        ? left
        : ordered
            .times(p.quantity)
            .dividedBy(planned)
            .toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP);
    left = left.minus(share);
    return { ...p, share };
  });
}
