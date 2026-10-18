/*
 * Words for the costing sheet, shared by the screens and the server (no
 * database). The buyer's way of paying is one of TT, a direct bank transfer
 * or an LC, set on the buyer and changeable per order; there is no default.
 */

export const TRADE_PAYMENTS = ["TT", "BANK_TRANSFER", "LC"] as const;
export type TradePaymentKey = (typeof TRADE_PAYMENTS)[number];

export const TRADE_PAYMENT_LABELS: Record<TradePaymentKey, string> = {
  TT: "TT",
  BANK_TRANSFER: "Direct bank transfer",
  LC: "LC",
};

export const CM_PER_LABELS = { PIECE: "per piece", DOZEN: "per dozen" } as const;

/**
 * A CM agreed before, as it was agreed: 125 a dozen stays 125 a dozen (the
 * piece share, 10.42, is only for display; the money maths uses the dozen price).
 */
export function pastCmTerms(h: {
  cm: number;
  cmPer: "PIECE" | "DOZEN";
  cmPerDozen: number | null;
}): { amount: number; per: "PIECE" | "DOZEN" } {
  return h.cmPer === "DOZEN" && h.cmPerDozen !== null
    ? { amount: h.cmPerDozen, per: "DOZEN" }
    : { amount: h.cm, per: "PIECE" };
}
export const FABRIC_UNIT_LABELS = { KG: "kg", YARD: "yard" } as const;
export const DECISION_LABELS = { TAKE: "Taken", DECLINE: "Declined" } as const;

/**
 * The owner's profit % for an order (v6.4.2): at least 10%, no upper limit
 * (an item can make 200%), and still no default. The sheet stores up to
 * 999.99%. A sheet saved below 10% before the rule keeps its figure, shows
 * a note, and reaches 10% when it is next edited.
 */
export const PROFIT_MIN_PERCENT = 10;
export const PROFIT_MAX_STORED = 999.99;
export const PROFIT_MIN_MESSAGE = `Give a profit % of at least ${PROFIT_MIN_PERCENT}%.`;
export const PROFIT_MAX_MESSAGE = `At most ${PROFIT_MAX_STORED}%, the most a sheet holds.`;

/** Whether a saved profit % is under the minimum (a sheet saved before the rule). */
export const profitUnderMinimum = (profit: number | null) =>
  profit !== null && profit < PROFIT_MIN_PERCENT;

/** The note on a sheet saved under the minimum. */
export const profitUnderMinimumNote = (profit: number) =>
  `Saved at ${Number(profit.toFixed(2))}% profit, under the ${PROFIT_MIN_PERCENT}% minimum. Raise it to at least ${PROFIT_MIN_PERCENT}% when you edit it.`;

/**
 * The profit % and the percent lines come off the selling price, so together
 * they must stay under 100% for a price to leave them. A profit given "on the
 * cost" (200% on the cost is three times the cost) is this share of the price.
 */
export const shareOfPrice = (onCost: number) => (onCost / (100 + onCost)) * 100;

/**
 * The markup on the cost a share of the price gives (15% of price is 17.65% on
 * cost); none at 100% or more, where no price leaves the profit.
 */
export const onCostOf = (ofPrice: number) =>
  ofPrice < 100 ? (ofPrice / (100 - ofPrice)) * 100 : null;

const two = (n: number) => String(Number(n.toFixed(2)));

/**
 * Why a sheet would leave no price, or null when it leaves one: the profit %
 * and the percent lines (source tax, bank charges, commission) come off the
 * price, so together they stay under 100%. A big profit was likely meant on
 * the cost: 200% on cost is 66.67% of the price.
 */
export function noPriceLeft(profit: number | null, lines: number) {
  const total = Math.round(((profit ?? 0) + lines) * 100) / 100;
  if (total < 100) return null;
  if (profit === null) {
    return `Source tax, bank charges and commission come to ${two(total)}% of the price, which leaves no price. Lower them.`;
  }
  const meant = `Did you mean ${two(profit)}% on cost? That is ${two(shareOfPrice(profit))}% of the price.`;
  return lines > 0
    ? `${two(profit)}% profit plus ${two(lines)}% off the price (source tax, bank charges and commission) is ${two(total)}% of the price, which leaves no price. ${meant}`
    : `${two(profit)}% of the price leaves no price. ${meant}`;
}

/** A profit % as the sheet keeps it, with its markup on the cost beside it. */
export function profitBothWays(ofPrice: number) {
  const onCost = onCostOf(ofPrice);
  return onCost === null
    ? `${two(ofPrice)}% of price: no price can leave that`
    : `${two(ofPrice)}% of price = ${two(onCost)}% on cost`;
}
