import { addDays, dayRange, localDay } from "@/lib/dates";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeSalesAmounts, canSeeStock } from "@/modules/dashboard/access";
import { homePeriod, homeRangeSchema, type HomePeriod } from "@/modules/dashboard/home.service";
import {
  buyerTopStyles,
  salesTotals,
  sharePct,
  type TopBuyer,
  topBuyers,
  topSellers,
} from "@/modules/dashboard/sales-figures";
import { DEFAULT_PRODUCTION_LEAD_DAYS } from "@/modules/production/project.service";

/*
 * The Home screen's predictive insights:
 *
 *   Stock runway  the styles that sold the most pieces in the last 30 days, and
 *                 how long the pieces available now would last at that speed:
 *                 available ÷ (pieces sold in 30 days ÷ 30). Red when it runs
 *                 out within 15 days, amber when it runs out before a new batch
 *                 could be made (a production project's usual 45 days).
 *   Top buyer     the buyer who bought the most in the period chosen at the top
 *                 (sales after discounts, as everywhere on the dashboard), what
 *                 they bought most, and the two after them. Walk-in sales are
 *                 not one buyer, so they are left out.
 *
 * The runway is for anyone who sees stock (pieces only); the top buyer for those
 * who see sales amounts.
 */

/** The sales speed is read over this many days, today included. */
export const RUNWAY_SPEED_DAYS = 30;

/** Stock that runs out within this many days is short. */
export const RUNWAY_SHORT_DAYS = 15;

/** Stock that runs out before a new batch could be made should be ordered now. */
export const RUNWAY_ORDER_DAYS = DEFAULT_PRODUCTION_LEAD_DAYS;

/** Styles the runway lists. */
const RUNWAY_ROWS = 5;

/** The top buyer and the two after them. */
const BUYER_ROWS = 3;

/** What the top buyer bought most. */
const BUYER_STYLES = 3;

export type RunwayStatus = "OUT" | "SHORT" | "ORDER" | "OK";

/** How long `available` pieces last at `sold` pieces in `RUNWAY_SPEED_DAYS` days, in whole days. */
export function runwayDays(available: number, sold: number): number {
  if (available <= 0 || sold <= 0) return 0;
  return Math.floor((available * RUNWAY_SPEED_DAYS) / sold);
}

export function runwayStatus(available: number, days: number): RunwayStatus {
  if (available <= 0) return "OUT";
  if (days < RUNWAY_SHORT_DAYS) return "SHORT";
  if (days < RUNWAY_ORDER_DAYS) return "ORDER";
  return "OK";
}

/** Who sees which predictive insight. */
export function predictiveAccess(ctx: Pick<CompanyContext, "can">) {
  return { runway: canSeeStock(ctx), topBuyer: canSeeSalesAmounts(ctx) };
}

async function stockRunway(ctx: CompanyContext, today: string) {
  const from = addDays(today, -(RUNWAY_SPEED_DAYS - 1));
  const { start, end } = dayRange(from, today, ctx.company.timezone);
  const top = await topSellers(
    ctx.company.id,
    { start: start!, end: end! },
    { groupBy: "STYLE", sortBy: "QUANTITY", limit: RUNWAY_ROWS },
  );
  const items = top.items.map((row) => {
    const available = Math.max(row.available, 0);
    const days = runwayDays(available, row.pieces);
    return {
      styleId: row.id,
      styleCode: row.styleCode,
      styleName: row.styleName,
      /** Pieces sold in the last 30 days, and per day at that speed. */
      sold: row.pieces,
      perDay: (row.pieces / RUNWAY_SPEED_DAYS).toFixed(1),
      /** Sellable pieces now: A-grade on hand less pieces reserved for open orders. */
      available,
      days,
      /** The day the stock would run out at this speed. */
      runsOutOn: addDays(today, days),
      status: runwayStatus(available, days),
    };
  });
  return {
    speedDays: RUNWAY_SPEED_DAYS,
    from,
    to: today,
    shortDays: RUNWAY_SHORT_DAYS,
    orderDays: RUNWAY_ORDER_DAYS,
    /** "Order now" starts a production project; others can open the product's stock. */
    orderNow: ctx.can("production.manage")
      ? ("PRODUCTION" as const)
      : ctx.can("inventory.view")
        ? ("PRODUCT" as const)
        : null,
    items,
  };
}

const buyerView = (row: TopBuyer) => ({
  partyId: row.partyId,
  code: row.code,
  name: row.name,
  invoices: row.orders,
  pieces: row.pieces,
  net: row.net.toFixed(2),
});

async function topBuyerOf(ctx: CompanyContext, period: HomePeriod) {
  const range = { start: period.start, end: period.end };
  const [buyers, total] = await Promise.all([
    topBuyers(ctx.company.id, range, BUYER_ROWS),
    salesTotals(ctx.company.id, range),
  ]);
  const top = buyers[0];
  const styles = top
    ? await buyerTopStyles(ctx.company.id, { partyId: top.partyId }, BUYER_STYLES, range)
    : [];
  return {
    /** Every sale in the period, walk-ins included. */
    total: total.net.toFixed(2),
    buyer: top
      ? {
          ...buyerView(top),
          /** Share of the period's sales, in percent to one place. */
          sharePct: sharePct(top.net, total.net),
          styles: styles.map((s) => ({ id: s.id, code: s.code, name: s.name, pieces: s.pieces })),
        }
      : null,
    runnersUp: buyers.slice(1).map(buyerView),
  };
}

/**
 * The stock runway and the period's top buyer. A part this person may not see
 * comes back as null.
 */
export async function getPredictiveInsights(
  ctx: CompanyContext,
  raw: unknown = {},
  now = new Date(),
) {
  const { range } = homeRangeSchema.parse(raw);
  const tz = ctx.company.timezone;
  const today = localDay(now, tz);
  const period = homePeriod(range, today, tz);
  const can = predictiveAccess(ctx);
  const [runway, topBuyer] = await Promise.all([
    can.runway ? stockRunway(ctx, today) : null,
    can.topBuyer ? topBuyerOf(ctx, period) : null,
  ]);
  return {
    range,
    from: period.from,
    to: period.to,
    currency: ctx.company.currency,
    runway,
    topBuyer,
    /** Which pages the rows may link to. */
    open: { buyers: ctx.can("parties.view"), products: ctx.can("inventory.view") },
  };
}

export type PredictiveInsights = Awaited<ReturnType<typeof getPredictiveInsights>>;
