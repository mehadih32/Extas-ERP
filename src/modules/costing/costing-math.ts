/*
 * The order costing sheet's sums (v6.2 rules), per dozen like the owner's
 * sheet: fabric (consumption × the supplier's price per kg, per yard for
 * wovens) + trims + print, embroidery and wash + testing, transport and
 * samples + the CM fixed with the factory (per piece × 12, or per dozen).
 * No office overhead. The percent lines (source tax, bank charges,
 * commission and the owner's profit % for this order) come off the selling
 * price, so they are grossed up: price = cost ÷ (1 − their total). No default
 * profit: without one there is no price at profit. Pure; no database.
 */

export type CmPer = "PIECE" | "DOZEN";

export type CostLineInput = {
  quantity: number;
  /** Fabric per dozen (kg, or yards for wovens). */
  consumption: number | null;
  /** The supplier's price per kg (per yard). */
  fabricPrice: number | null;
  trimsPerDozen: number;
  valueAddPerDozen: number;
  otherPerDozen: number;
  cmAmount: number | null;
  cmPer: CmPer;
  /** The buyer's price per piece. */
  buyerPrice: number | null;
};

export type PercentLines = {
  sourceTax: number;
  bankCharge: number;
  commission: number;
  /** The owner's profit % for this order; null until given. */
  profit: number | null;
};

export type CostLine = {
  /** Per dozen. Null when the part is missing. */
  fabric: number | null;
  cm: number | null;
  trims: number;
  valueAdd: number;
  other: number;
  /** All the known parts, per dozen. */
  direct: number;
  costPerPiece: number;
  /** What is still missing ("fabric price", "CM"): the cost is too low until given. */
  missing: string[];
  /** The price per piece that leaves the owner's profit %, or null without one. */
  priceAtProfit: number | null;
  /** The profit % the buyer's price leaves, after the percent lines. */
  buyerProfit: number | null;
};

export type CostSheet = {
  lines: CostLine[];
  pieces: number;
  /** For all the pieces. */
  cost: number;
  valueAtBuyerPrice: number | null;
  profitAtBuyerPrice: number | null;
  valueAtProfit: number | null;
};

export const round = (value: number, places = 4) => {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
};

/** The percent lines other than profit, which every price carries. */
export const deductions = (p: PercentLines) => p.sourceTax + p.bankCharge + p.commission;

/** The price (per dozen) that leaves `profit` % after the percent lines; null when impossible. */
export function grossUp(direct: number, p: PercentLines): number | null {
  if (p.profit === null) return null;
  const share = 1 - (deductions(p) + p.profit) / 100;
  if (share <= 0) return null;
  return direct / share;
}

/** The profit % a price (per dozen) leaves after the cost and the percent lines. */
export function profitAt(direct: number, pricePerDozen: number, p: PercentLines): number | null {
  if (pricePerDozen <= 0) return null;
  return (1 - deductions(p) / 100 - direct / pricePerDozen) * 100;
}

export function costLine(line: CostLineInput, p: PercentLines): CostLine {
  const missing: string[] = [];
  let fabric: number | null = null;
  if (line.consumption === null) missing.push("fabric consumption");
  if (line.fabricPrice === null) missing.push("fabric price");
  if (line.consumption !== null && line.fabricPrice !== null) {
    fabric = line.consumption * line.fabricPrice;
  }
  const cm =
    line.cmAmount === null ? null : line.cmPer === "DOZEN" ? line.cmAmount : line.cmAmount * 12;
  if (cm === null) missing.push("CM");
  const direct =
    (fabric ?? 0) + (cm ?? 0) + line.trimsPerDozen + line.valueAddPerDozen + line.otherPerDozen;
  const atProfit = grossUp(direct, p);
  const buyerProfit = line.buyerPrice === null ? null : profitAt(direct, line.buyerPrice * 12, p);
  return {
    fabric: fabric === null ? null : round(fabric),
    cm: cm === null ? null : round(cm),
    trims: round(line.trimsPerDozen),
    valueAdd: round(line.valueAddPerDozen),
    other: round(line.otherPerDozen),
    direct: round(direct),
    costPerPiece: round(direct / 12),
    missing,
    priceAtProfit: atProfit === null ? null : round(atProfit / 12),
    buyerProfit: buyerProfit === null ? null : round(buyerProfit, 2),
  };
}

export function costSheet(lines: CostLineInput[], p: PercentLines): CostSheet {
  const costed = lines.map((l) => costLine(l, p));
  const pieces = lines.reduce((sum, l) => sum + l.quantity, 0);
  // From the cost a dozen, so a piece's rounding is not multiplied by the pieces.
  const cost = costed.reduce((sum, c, i) => sum + (c.direct / 12) * lines[i]!.quantity, 0);
  const priced = lines.every((l) => l.buyerPrice !== null) && lines.length > 0;
  const value = priced ? lines.reduce((sum, l) => sum + l.buyerPrice! * l.quantity, 0) : null;
  const prices = costed.map((c) => grossUp(c.direct, p));
  const atProfit = prices.every((x) => x !== null) && lines.length > 0;
  return {
    lines: costed,
    pieces,
    cost: round(cost, 2),
    valueAtBuyerPrice: value === null ? null : round(value, 2),
    profitAtBuyerPrice: value === null ? null : round(value * (1 - deductions(p) / 100) - cost, 2),
    valueAtProfit: atProfit
      ? round(
          prices.reduce<number>((sum, x, i) => sum + (x! / 12) * lines[i]!.quantity, 0),
          2,
        )
      : null,
  };
}
