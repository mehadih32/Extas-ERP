import { type InvoiceStatus, Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";

/*
 * Pure money helpers for sales documents. Amounts are Decimals rounded to 2
 * places (half up) so totals never drift by floating-point pennies.
 */

type Num = Prisma.Decimal | number | string;
export const money = (v: Num) =>
  new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const ZERO = new Prisma.Decimal(0);
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), ZERO);

/** Quantity for a quotation line: explicit, or the sum of its size breakdown. */
export function quotationLineQuantity(item: {
  quantity?: number;
  sizeBreakdown?: Record<string, number> | null;
}): number {
  return item.quantity ?? Object.values(item.sizeBreakdown ?? {}).reduce((a, b) => a + b, 0);
}

export function quotationTotals(
  items: Array<{ quantity: number; unitPrice: Num }>,
  discount: Num = 0,
  tax: Num = 0,
) {
  const lineTotals = items.map((i) => money(new Prisma.Decimal(i.unitPrice).times(i.quantity)));
  const subtotal = sum(lineTotals);
  const disc = money(discount);
  if (disc.gt(subtotal)) {
    throw new AppError("VALIDATION", "The discount is larger than the subtotal.");
  }
  return {
    lineTotals,
    subtotal,
    discount: disc,
    tax: money(tax),
    total: subtotal.minus(disc).plus(money(tax)),
  };
}

export type PricedLine = { variantId: string; quantity: number; unitPrice: Num; discount?: Num };

export function orderTotals(
  lines: PricedLine[],
  charges: { discount?: Num; shippingCharge?: Num; tax?: Num } = {},
) {
  const lineTotals = lines.map((l) => {
    const gross = money(new Prisma.Decimal(l.unitPrice).times(l.quantity));
    const lineDiscount = money(l.discount ?? 0);
    if (lineDiscount.gt(gross)) {
      throw new AppError("VALIDATION", "A line discount is larger than the line amount.");
    }
    return gross.minus(lineDiscount);
  });
  const subtotal = sum(lineTotals);
  const discount = money(charges.discount ?? 0);
  if (discount.gt(subtotal)) {
    throw new AppError("VALIDATION", "The discount is larger than the subtotal.");
  }
  const shippingCharge = money(charges.shippingCharge ?? 0);
  const tax = money(charges.tax ?? 0);
  return {
    lineTotals,
    subtotal,
    discount,
    shippingCharge,
    tax,
    /** What the goods earn after discounts (posted to Sales). */
    netSales: subtotal.minus(discount),
    total: subtotal.minus(discount).plus(shippingCharge).plus(tax),
  };
}

export type RequestedLine = {
  variantId: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
};

/**
 * Flattens matrix entries into SKU lines and merges repeats of the same SKU.
 * Zero-quantity matrix cells are ignored.
 */
export function collectOrderLines(input: {
  lines?: RequestedLine[];
  matrix?: Array<{ styleId: string; unitPrice?: number; quantities: Record<string, number> }>;
}): { lines: RequestedLine[]; matrixStyles: Map<string, string> } {
  const matrixStyles = new Map<string, string>(); // variantId -> styleId it was entered under
  const raw: RequestedLine[] = [...(input.lines ?? [])];
  for (const entry of input.matrix ?? []) {
    for (const [variantId, quantity] of Object.entries(entry.quantities)) {
      if (quantity <= 0) continue;
      matrixStyles.set(variantId, entry.styleId);
      raw.push({ variantId, quantity, unitPrice: entry.unitPrice });
    }
  }
  const merged = new Map<string, RequestedLine>();
  for (const line of raw) {
    const existing = merged.get(line.variantId);
    if (!existing) {
      merged.set(line.variantId, { ...line });
      continue;
    }
    if (
      line.unitPrice !== undefined &&
      existing.unitPrice !== undefined &&
      line.unitPrice !== existing.unitPrice
    ) {
      throw new AppError("VALIDATION", "The same SKU is entered twice with different prices.");
    }
    existing.quantity += line.quantity;
    existing.unitPrice ??= line.unitPrice;
    existing.discount = (existing.discount ?? 0) + (line.discount ?? 0) || undefined;
  }
  if (merged.size === 0) throw new AppError("VALIDATION", "Add at least one item.");
  return { lines: [...merged.values()], matrixStyles };
}

/** Advance due on a proforma, e.g. 30% of the total. */
export function advanceAmount(total: Num, percent: Num) {
  return money(new Prisma.Decimal(total).times(percent).dividedBy(100));
}

export function invoiceStatusFor(total: Num, paid: Num): InvoiceStatus {
  const t = money(total);
  const p = money(paid);
  if (p.gte(t)) return "PAID";
  return p.gt(0) ? "PARTIALLY_PAID" : "UNPAID";
}

/** One invoice line in a sales return: the line as billed, its earlier returns and what comes back now. */
export type ReturnLine = {
  lineTotal: Num;
  quantity: number;
  /** Pieces of the line on earlier returns that are not void, and what they were credited. */
  returnedQuantity: number;
  returnedAmount: Num;
  /** Pieces coming back now (at most what is left of the line). */
  take: number;
};

/**
 * What a sales return credits. Each line is priced from what is left of its
 * invoice line, so a line's returns add up to its total exactly. The return's
 * share of the invoice discount and VAT goes by the value of its goods; the
 * return that brings back the last piece takes whatever is left of both.
 */
export function returnTotals(args: {
  lines: ReturnLine[];
  invoice: { subtotal: Num; discount: Num; tax: Num };
  /** The discount and VAT earlier returns (not void) already took back. */
  earlier: { discount: Num; tax: Num };
  /** Every piece invoiced is back once this return is made. */
  last: boolean;
}) {
  const amounts = args.lines.map((l) => {
    const left = l.quantity - l.returnedQuantity;
    if (l.take < 1 || l.take > left) {
      throw new AppError("VALIDATION", "More pieces than are left on the line.");
    }
    const value = money(l.lineTotal).minus(money(l.returnedAmount));
    return l.take === left ? value : money(value.times(l.take).dividedBy(left));
  });
  const goods = sum(amounts);
  const subtotal = money(args.invoice.subtotal);
  const fullDiscount = money(args.invoice.discount);
  const fullTax = money(args.invoice.tax);
  const discountLeft = Prisma.Decimal.max(fullDiscount.minus(money(args.earlier.discount)), ZERO);
  const taxLeft = Prisma.Decimal.max(fullTax.minus(money(args.earlier.tax)), ZERO);
  const discount = args.last
    ? discountLeft
    : subtotal.gt(0)
      ? Prisma.Decimal.min(money(fullDiscount.times(goods).dividedBy(subtotal)), discountLeft)
      : ZERO;
  const net = subtotal.minus(fullDiscount);
  const tax = args.last
    ? taxLeft
    : net.gt(0)
      ? Prisma.Decimal.min(money(fullTax.times(goods.minus(discount)).dividedBy(net)), taxLeft)
      : ZERO;
  return { amounts, goods, discount, tax, total: goods.minus(discount).plus(tax) };
}
