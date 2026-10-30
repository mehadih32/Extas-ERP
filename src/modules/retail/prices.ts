import { Prisma, type RetailGrade, type RetailPriceRule } from "@prisma/client";

/*
 * A retail store's buying price (plan v6 sec 2), as plain functions. A hand
 * price wins: one SKU's first, then the style's colour, then the style. Without
 * one, the store's rule for the grade makes it from that grade's cost: the cost
 * plus a % or an amount, or (B-grade only) one fixed price. No price is ever 0:
 * a SKU with no hand price, no rule or no cost has no price (null), and the
 * store is not shown it.
 */

export type Rule = { rule: RetailPriceRule | null; value: Prisma.Decimal.Value | null };

export type HandPrice = {
  grade: RetailGrade;
  styleId: string;
  colorId: string | null;
  variantId: string | null;
  price: Prisma.Decimal.Value;
};

export type PricedVariant = {
  id: string;
  styleId: string;
  colorId: string;
  avgCost: Prisma.Decimal.Value;
  bGradeAvgCost: Prisma.Decimal.Value;
};

/** The one place a hand price sits: a style, a style's colour or one SKU. */
export function scopeKeyOf(p: Pick<HandPrice, "styleId" | "colorId" | "variantId">): string {
  if (p.variantId) return `V:${p.variantId}`;
  if (p.colorId) return `C:${p.styleId}:${p.colorId}`;
  return `S:${p.styleId}`;
}

const ZERO = new Prisma.Decimal(0);

/** The price a rule makes from a cost, to 2 decimals; null when it makes none. */
export function ruleOnCost(rule: Rule, cost: Prisma.Decimal.Value): Prisma.Decimal | null {
  if (!rule.rule || rule.value === null) return null;
  const value = new Prisma.Decimal(rule.value);
  if (rule.rule === "FIXED") return value.gt(ZERO) ? value.toDecimalPlaces(2) : null;
  const base = new Prisma.Decimal(cost);
  // A rule on a cost the ERP does not know would sell at a made-up price.
  if (base.lte(ZERO)) return null;
  const price = rule.rule === "PERCENT" ? base.mul(value.div(100).add(1)) : base.add(value);
  const rounded = price.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return rounded.gt(ZERO) ? rounded : null;
}

/** The hand price for a SKU and grade, the narrowest place first. */
export function handPriceFor(
  prices: readonly HandPrice[],
  variant: Pick<PricedVariant, "id" | "styleId" | "colorId">,
  grade: RetailGrade,
): Prisma.Decimal | null {
  const keys = [
    `V:${variant.id}`,
    `C:${variant.styleId}:${variant.colorId}`,
    `S:${variant.styleId}`,
  ];
  for (const key of keys) {
    const hit = prices.find((p) => p.grade === grade && scopeKeyOf(p) === key);
    if (hit) return new Prisma.Decimal(hit.price);
  }
  return null;
}

export type StorePrice = {
  price: Prisma.Decimal | null;
  /** Where it came from: a hand price, the rule, or none. */
  from: "HAND" | "RULE" | "NONE";
};

/** A SKU's buying price for a store and grade. */
export function storePriceOf(
  store: { a: Rule; b: Rule },
  prices: readonly HandPrice[],
  variant: PricedVariant,
  grade: RetailGrade,
): StorePrice {
  const hand = handPriceFor(prices, variant, grade);
  if (hand) return { price: hand, from: "HAND" };
  const cost = grade === "A" ? variant.avgCost : variant.bGradeAvgCost;
  const ruled = ruleOnCost(grade === "A" ? store.a : store.b, cost);
  return ruled ? { price: ruled, from: "RULE" } : { price: null, from: "NONE" };
}

/** The average cost of the SKUs a hand price covers (those with a cost), for "cost changed". */
export function scopeCost(costs: readonly Prisma.Decimal.Value[]): Prisma.Decimal {
  const known = costs.map((c) => new Prisma.Decimal(c)).filter((c) => c.gt(ZERO));
  if (known.length === 0) return ZERO;
  return known
    .reduce((sum, c) => sum.add(c), ZERO)
    .div(known.length)
    .toDecimalPlaces(4);
}

/** A cost that moved 1% or more since the price was set (or appeared from none). */
export function costMoved(then: Prisma.Decimal.Value, now: Prisma.Decimal.Value): boolean {
  const before = new Prisma.Decimal(then);
  const after = new Prisma.Decimal(now);
  if (before.lte(ZERO)) return after.gt(ZERO);
  return after.sub(before).abs().div(before).gte(0.01);
}

/** "Cost + 25%", "Cost + BDT 120.00", "BDT 450.00 each" or "No rule". */
export function ruleText(rule: Rule, currency: string): string {
  if (!rule.rule || rule.value === null) return "No rule";
  const value = new Prisma.Decimal(rule.value);
  if (rule.rule === "PERCENT") return `Cost + ${value.toDecimalPlaces(2).toString()}%`;
  if (rule.rule === "AMOUNT") return `Cost + ${currency} ${value.toFixed(2)}`;
  return `${currency} ${value.toFixed(2)} each`;
}
