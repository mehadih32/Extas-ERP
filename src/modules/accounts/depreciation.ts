import { type DepreciationMethod, Prisma } from "@prisma/client";

import { money, ZERO } from "@/modules/accounts/balances";
import { addDays, monthEnd } from "@/modules/accounts/periods";

/*
 * Depreciation, month by month (pure functions, no database).
 *   Straight line      the same charge every month: (cost - salvage) x rate / 12
 *   Reducing balance   book value falls by the yearly rate each year, charged
 *                      monthly: book value x (1 - (1 - rate)^(1/12))
 * A month the asset is held only partly (bought or sold mid-month) is charged
 * for the days it was held. Book value never goes below the salvage value.
 */

export type DepreciableAsset = {
  cost: Prisma.Decimal;
  salvage: Prisma.Decimal;
  /** % per year; null or 0 means not depreciated (land, for example). */
  ratePct: Prisma.Decimal | null;
  method: DepreciationMethod;
  /** Book value before these charges. */
  bookValue: Prisma.Decimal;
};

export type MonthCharge = {
  month: string;
  from: string;
  to: string;
  days: number;
  amount: Prisma.Decimal;
};

const daysInMonth = (day: string) => Number(monthEnd(day).slice(8, 10));

/** Charges from `fromDay` to `toDay` (both included, calendar days). */
export function depreciationCharges(
  asset: DepreciableAsset,
  fromDay: string,
  toDay: string,
): { charges: MonthCharge[]; total: Prisma.Decimal; bookValueAfter: Prisma.Decimal } {
  const charges: MonthCharge[] = [];
  let bookValue = asset.bookValue;
  const rate = asset.ratePct ? new Prisma.Decimal(asset.ratePct).dividedBy(100) : ZERO;
  if (rate.lte(0) || fromDay > toDay) {
    return { charges, total: ZERO, bookValueAfter: bookValue };
  }
  const fullMonthStraight = asset.cost.minus(asset.salvage).times(rate).dividedBy(12);

  for (let from = fromDay; from <= toDay;) {
    const end = monthEnd(from) < toDay ? monthEnd(from) : toDay;
    const days = Number(end.slice(8, 10)) - Number(from.slice(8, 10)) + 1;
    const share = new Prisma.Decimal(days).dividedBy(daysInMonth(from));
    const headroom = bookValue.minus(asset.salvage);
    if (headroom.lte(0)) break;

    let amount =
      asset.method === "STRAIGHT_LINE"
        ? fullMonthStraight.times(share)
        : bookValue.times(
            new Prisma.Decimal(1).minus(new Prisma.Decimal(1).minus(rate).pow(share.dividedBy(12))),
          );
    amount = Prisma.Decimal.min(money(amount), headroom);
    if (amount.lte(0)) break;
    charges.push({ month: from.slice(0, 7), from, to: end, days, amount });
    bookValue = bookValue.minus(amount);
    from = addDays(end, 1);
  }
  const total = charges.reduce((s, c) => s.plus(c.amount), ZERO);
  return { charges, total, bookValueAfter: bookValue };
}

/** A full month's charge right now (for the register: "about 2,500.00 a month"). */
export function monthlyCharge(asset: DepreciableAsset): Prisma.Decimal {
  const rate = asset.ratePct ? new Prisma.Decimal(asset.ratePct).dividedBy(100) : ZERO;
  if (rate.lte(0)) return ZERO;
  const headroom = Prisma.Decimal.max(asset.bookValue.minus(asset.salvage), ZERO);
  const amount =
    asset.method === "STRAIGHT_LINE"
      ? asset.cost.minus(asset.salvage).times(rate).dividedBy(12)
      : asset.bookValue.times(
          new Prisma.Decimal(1).minus(
            new Prisma.Decimal(1).minus(rate).pow(new Prisma.Decimal(1).dividedBy(12)),
          ),
        );
  return Prisma.Decimal.min(money(amount), headroom);
}
