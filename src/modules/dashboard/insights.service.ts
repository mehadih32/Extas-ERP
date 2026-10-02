import type { Company } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { addDays, resolvePeriod } from "@/modules/accounts/periods";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials, canSeeSalesAmounts, canSeeStock } from "@/modules/dashboard/access";
import { type TopSeller, topSellers } from "@/modules/dashboard/sales-figures";
import { insightsQuerySchema } from "@/modules/dashboard/schemas";
import {
  deadAndSlowStock,
  highestStock,
  lowStock,
  type SkuStock,
  type SlowSku,
  type StockWindow,
} from "@/modules/dashboard/stock-figures";

/*
 * The dashboard's Insights widget: top selling SKUs (or styles) for a period,
 * the SKUs holding the most stock, dead and slow stock, and the low stock
 * warning (below the company's threshold, 5 pieces by default).
 *
 * Quantities are for anyone who sees stock. Sales values need sales.view (or
 * the financials); costs, stock values and margins need dashboard.financials or
 * accounts.view. Hidden amounts come back as null.
 */

/** "Sold recently" next to low stock covers this many days. */
export const RECENT_DAYS = 30;

/** The slow-stock window ending today, in company time. */
export function stockWindow(
  company: Pick<Company, "timezone">,
  days: { slowDays: number; coverDays: number },
  now: Date = new Date(),
): StockWindow {
  const today = localDay(now, company.timezone);
  return {
    cutoff: startOfDayInZone(addDays(today, -days.slowDays), company.timezone),
    recentSince: startOfDayInZone(addDays(today, -RECENT_DAYS), company.timezone),
    slowDays: days.slowDays,
    coverDays: days.coverDays,
  };
}

const share = (part: number, whole: number) =>
  whole === 0 ? null : ((part / whole) * 100).toFixed(1);

const marginPct = (net: Prisma.Decimal, cost: Prisma.Decimal) =>
  net.isZero() ? null : net.minus(cost).dividedBy(net).times(100).toFixed(1);

/** A top seller as the API shows it, with amounts the reader may not see set to null. */
export function topSellerView(
  ctx: Pick<CompanyContext, "can">,
  row: TopSeller,
  rank: number,
  totalPieces: number,
) {
  const sales = canSeeSalesAmounts(ctx);
  const costs = canSeeFinancials(ctx);
  return {
    rank,
    id: row.id,
    sku: row.sku,
    styleCode: row.styleCode,
    styleName: row.styleName,
    colorName: row.colorName,
    sizeName: row.sizeName,
    pieces: row.pieces,
    orders: row.orders,
    skus: row.skus,
    /** Share of all pieces sold in the period, in percent. */
    sharePct: share(row.pieces, totalPieces),
    net: sales ? row.net.toFixed(2) : null,
    avgPrice: sales && row.pieces > 0 ? row.net.dividedBy(row.pieces).toFixed(2) : null,
    cost: costs ? row.cost.toFixed(2) : null,
    marginPct: costs ? marginPct(row.net, row.cost) : null,
    available: row.available,
  };
}

/** A SKU's stock as the API shows it; its value only for readers of the financials. */
export function skuStockView(ctx: Pick<CompanyContext, "can">, row: SkuStock, timeZone: string) {
  return {
    variantId: row.variantId,
    sku: row.sku,
    styleCode: row.styleCode,
    styleName: row.styleName,
    colorName: row.colorName,
    sizeName: row.sizeName,
    onHand: row.onHand,
    aGrade: row.aGrade,
    bGrade: row.bGrade,
    reserved: row.reserved,
    available: row.available,
    value: canSeeFinancials(ctx) ? row.availableValue.toFixed(2) : null,
    soldRecently: row.soldRecently,
    lastSoldOn: row.lastSoldAt ? localDay(row.lastSoldAt, timeZone) : null,
  };
}

export function slowSkuView(ctx: Pick<CompanyContext, "can">, row: SlowSku, timeZone: string) {
  return {
    ...skuStockView(ctx, row, timeZone),
    movement: row.movement,
    soldInWindow: row.soldInWindow,
    daysOfCover: row.daysOfCover,
  };
}

export async function getDashboardInsights(
  ctx: CompanyContext,
  raw: unknown = {},
  now: Date = new Date(),
) {
  if (!canSeeStock(ctx)) {
    throw new AppError("FORBIDDEN", "You do not have permission to see the dashboard.");
  }
  const q = insightsQuerySchema.parse(raw);
  if (q.sortBy === "REVENUE" && !canSeeSalesAmounts(ctx)) {
    throw new AppError("FORBIDDEN", "Sorting by sales value needs permission to see sales.");
  }
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const period = resolvePeriod(
    { period: q.period ?? (q.from || q.to ? undefined : "ONE_MONTH"), from: q.from, to: q.to },
    ctx.company,
    now,
  );
  const window = stockWindow(ctx.company, q, now);
  const threshold = ctx.company.lowStockThreshold;
  const costs = canSeeFinancials(ctx);

  const [top, highest, deadSlow, low] = await Promise.all([
    topSellers(
      companyId,
      { start: period.start, end: period.end },
      { groupBy: q.groupBy, sortBy: q.sortBy, limit: q.limit },
    ),
    highestStock(companyId, window, q.limit),
    deadAndSlowStock(companyId, window, q.limit),
    lowStock(companyId, window, threshold, q.limit),
  ]);

  const group = (g: { skus: number; pieces: number; value: Prisma.Decimal }) => ({
    skus: g.skus,
    pieces: g.pieces,
    value: costs ? g.value.toFixed(2) : null,
  });

  return {
    asOf: localDay(now, tz),
    currency: ctx.company.currency,
    topSellers: {
      period: { period: period.period, from: period.from, to: period.to },
      groupBy: q.groupBy,
      sortBy: q.sortBy,
      totals: {
        /** SKUs (or styles) sold in the period, and everything they sold. */
        sold: top.totals.groups,
        pieces: top.totals.pieces,
        net: canSeeSalesAmounts(ctx) ? top.totals.net.toFixed(2) : null,
        marginPct: costs ? marginPct(top.totals.net, top.totals.cost) : null,
      },
      items: top.items.map((r, i) => topSellerView(ctx, r, i + 1, top.totals.pieces)),
    },
    highestStock: highest.map((r) => skuStockView(ctx, r, tz)),
    deadAndSlow: {
      slowDays: window.slowDays,
      coverDays: window.coverDays,
      dead: group(deadSlow.dead),
      slow: group(deadSlow.slow),
      items: deadSlow.items.map((r) => slowSkuView(ctx, r, tz)),
    },
    lowStock: {
      threshold,
      soldRecentlyDays: RECENT_DAYS,
      total: low.total,
      outOfStock: low.outOfStock,
      items: low.items.map((r) => skuStockView(ctx, r, tz)),
    },
  };
}
