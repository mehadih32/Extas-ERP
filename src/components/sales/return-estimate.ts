import type { SalesReturnForm } from "@/modules/sales/return-screens.service";

/*
 * The credit a sales return will give, worked out in the browser as the
 * pieces are entered, the way the server's returnTotals (sales/totals.ts)
 * works it out: each line from what is left of it, the discount and VAT by
 * the goods' share of the invoice, everything left of both on the return that
 * brings back the last piece. Whole cents throughout, rounded half up; the
 * server's figure is the one recorded.
 */

const cents = (fixed: string) => BigInt(Math.round(Number(fixed) * 100));
const fixed = (c: bigint) => {
  const sign = c < 0n ? "-" : "";
  const abs = c < 0n ? -c : c;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};
/** a × num ÷ den, rounded half up (all whole and not negative). */
const share = (a: bigint, num: bigint, den: bigint) =>
  den > 0n ? (2n * a * num + den) / (2n * den) : 0n;
const least = (a: bigint, b: bigint) => (a < b ? a : b);
const atLeastZero = (a: bigint) => (a < 0n ? 0n : a);

export type ReturnEstimate = {
  /** Each line's credit before discount and VAT, by line id ("0.00" when none come back). */
  amounts: Record<string, string>;
  pieces: number;
  goods: string;
  discount: string;
  tax: string;
  total: string;
};

/** What `takes` (pieces per line id) would credit on this invoice. */
export function estimateReturn(
  form: Pick<SalesReturnForm, "lines" | "shares">,
  takes: Record<string, number>,
): ReturnEstimate {
  const amounts: Record<string, string> = {};
  let goods = 0n;
  let pieces = 0;
  for (const line of form.lines) {
    const take = Math.min(Math.max(takes[line.id] ?? 0, 0), line.left);
    const value = cents(line.leftValue);
    const amount =
      take === 0 ? 0n : take === line.left ? value : share(value, BigInt(take), BigInt(line.left));
    amounts[line.id] = fixed(amount);
    goods += amount;
    pieces += take;
  }
  const s = form.shares;
  const subtotal = cents(s.subtotal);
  const fullDiscount = cents(s.discount);
  const fullTax = cents(s.tax);
  const discountLeft = atLeastZero(fullDiscount - cents(s.earlierDiscount));
  const taxLeft = atLeastZero(fullTax - cents(s.earlierTax));
  const last = pieces > 0 && s.returned + pieces >= s.ordered;
  const discount =
    pieces === 0
      ? 0n
      : last
        ? discountLeft
        : least(share(fullDiscount, goods, subtotal), discountLeft);
  const net = subtotal - fullDiscount;
  const tax =
    pieces === 0 ? 0n : last ? taxLeft : least(share(fullTax, goods - discount, net), taxLeft);
  return {
    amounts,
    pieces,
    goods: fixed(goods),
    discount: fixed(discount),
    tax: fixed(tax),
    total: fixed(goods - discount + tax),
  };
}
