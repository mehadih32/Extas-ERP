import {
  type MeasurementUnit,
  Prisma,
  type PurchaseOrderStatus,
  type RawMaterialKind,
} from "@prisma/client";

/*
 * Raw material valuation: moving average cost, kept exact to the paisa.
 *
 * Each material holds a quantity (in every store) and a value: its share of the
 * Raw Materials ledger. Goods coming in add their own value. Goods going out at
 * the average take value x quantity / on hand, and the last of the stock takes
 * whatever value is left, so a material's value is never negative and is zero
 * when none is left. Goods sent back on a bill (a void, or a return to the
 * supplier) go out at the bill price instead; when that would leave the value
 * out of step with what is left, the difference goes to Production & Inventory
 * Losses as a cost difference.
 */

type Num = Prisma.Decimal.Value;

const dec = (v: Num) => new Prisma.Decimal(v);
const round = (v: Num, places: number) =>
  dec(v).toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP);

export const ZERO = new Prisma.Decimal(0);
/** Quantities: up to 3 decimals (metres to the millimetre, kilograms to the gram). */
export const qty = (v: Num) => round(v, 3);
/** Money: 2 decimals. */
export const money = (v: Num) => round(v, 2);
/** Unit costs and prices: 4 decimals. */
export const unitCost = (v: Num) => round(v, 4);

export type Holding = { quantity: Prisma.Decimal; value: Prisma.Decimal };

/** The value of `quantity` taken out at the average cost. */
export function valueOut(holding: Holding, quantity: Prisma.Decimal): Prisma.Decimal {
  if (quantity.lte(0)) throw new RangeError("Quantity must be more than zero.");
  if (quantity.gt(holding.quantity)) {
    throw new RangeError(`Only ${holding.quantity.toString()} is on hand.`);
  }
  if (quantity.equals(holding.quantity)) return holding.value;
  return money(holding.value.times(quantity).dividedBy(holding.quantity));
}

/**
 * Takes `quantity` out at a set value (the bill price). Returns the value that
 * leaves the stock and the cost difference: the set value minus what left
 * (positive when the bill price is above what the stock still carries).
 */
export function removeAtValue(
  holding: Holding,
  quantity: Prisma.Decimal,
  target: Prisma.Decimal,
): { removed: Prisma.Decimal; difference: Prisma.Decimal } {
  if (quantity.lte(0)) throw new RangeError("Quantity must be more than zero.");
  if (quantity.gt(holding.quantity)) {
    throw new RangeError(`Only ${holding.quantity.toString()} is on hand.`);
  }
  if (target.isNegative()) throw new RangeError("Goods cannot go back at less than nothing.");
  const removed = quantity.equals(holding.quantity)
    ? holding.value
    : Prisma.Decimal.min(target, holding.value);
  return { removed, difference: target.minus(removed) };
}

/** Average cost per unit; the last known one while nothing is left. */
export function averageCost(holding: Holding, fallback: Prisma.Decimal): Prisma.Decimal {
  return holding.quantity.gt(0) ? unitCost(holding.value.dividedBy(holding.quantity)) : fallback;
}

/** Cost per unit of a movement (value / quantity), or the fallback for a zero quantity. */
export function costPerUnit(
  value: Prisma.Decimal,
  quantity: Prisma.Decimal,
  fallback: Prisma.Decimal,
) {
  return quantity.isZero() ? fallback : unitCost(value.abs().dividedBy(quantity.abs()));
}

// =============================================================================
// Units and codes
// =============================================================================

export const UNIT_LABELS: Record<MeasurementUnit, string> = {
  PCS: "pcs",
  METER: "m",
  YARD: "yd",
  KG: "kg",
  GRAM: "g",
  ROLL: "rolls",
  DOZEN: "dozen",
  GROSS: "gross",
  CONE: "cones",
  SET: "sets",
};

/** Units that are counted whole: pieces, rolls, cones and sets. */
export const WHOLE_UNITS: readonly MeasurementUnit[] = ["PCS", "ROLL", "CONE", "SET"];

/** Why a quantity does not suit the unit (a fraction of a whole unit), or null. */
export function unitProblem(unit: MeasurementUnit, quantity: Prisma.Decimal): string | null {
  if (WHOLE_UNITS.includes(unit) && !quantity.isInteger()) {
    return `${UNIT_LABELS[unit]} are counted whole; ${quantity.toString()} is not a whole number.`;
  }
  return null;
}

/** "120.5 m" */
export function formatQuantity(quantity: Prisma.Decimal.Value, unit: MeasurementUnit) {
  return `${dec(quantity).toString()} ${UNIT_LABELS[unit]}`;
}

/** Code prefix per kind: FAB-0001, TRM-0001... */
export const CODE_PREFIX: Record<RawMaterialKind, string> = {
  FABRIC: "FAB",
  TRIM: "TRM",
  ACCESSORY: "ACC",
  PACKAGING: "PKG",
  OTHER: "RM",
};

// =============================================================================
// Purchase orders
// =============================================================================

/** An order's status from what has arrived; closed and cancelled orders stay as they are. */
export function orderStatus(
  current: PurchaseOrderStatus,
  lines: Array<{ quantity: Prisma.Decimal; receivedQty: Prisma.Decimal }>,
): PurchaseOrderStatus {
  if (current === "CLOSED" || current === "CANCELLED") return current;
  const all = lines.length > 0 && lines.every((l) => l.receivedQty.gte(l.quantity));
  if (all) return "RECEIVED";
  return lines.some((l) => l.receivedQty.gt(0)) ? "PARTIALLY_RECEIVED" : "OPEN";
}

/** Still to come on an order line (never below zero when more arrived than ordered). */
export function pendingQuantity(line: { quantity: Prisma.Decimal; receivedQty: Prisma.Decimal }) {
  return Prisma.Decimal.max(line.quantity.minus(line.receivedQty), ZERO);
}
