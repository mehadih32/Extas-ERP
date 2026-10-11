import { Prisma } from "@prisma/client";
import { z } from "zod";

import { dateColumn, dateOnly, dayRange, daysBetween, localDay, weekday } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { money, ZERO } from "@/modules/accounts/balances";
import { addDays, monthEnd, monthStart } from "@/modules/accounts/periods";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials, canSeeSalesAmounts } from "@/modules/dashboard/access";
import { salesTotals } from "@/modules/dashboard/sales-figures";
import { DEFAULT_HOME_RANGE, HOME_RANGES, type HomeRange } from "@/modules/dashboard/schemas";
import { upcoming } from "@/modules/reminders/reminder.service";

/*
 * The Home screen's top bar and "The Pulse": what is on today's list, the
 * month's sales against the target, and the pace of sales, deliveries and
 * production for the period chosen at the top (today, this week, this month).
 * Every figure is read the way its own module reads it: sales as in
 * sales-figures.ts (invoices that are not void), money collected as on the
 * Payments tab (received less cash refunds), deliveries from the challans.
 * Each part is only worked out for the people who may see it.
 */

/** The week starts on Saturday, as the working week does in Bangladesh. */
const SATURDAY = 6;

export type HomePeriod = {
  range: HomeRange;
  /** First and last calendar day, inclusive: the period so far, up to today. */
  from: string;
  to: string;
  start: Date;
  end: Date;
};

/** Today, this week (Saturday to today) or this month (the 1st to today), in company time. */
export function homePeriod(range: HomeRange, today: string, timeZone: string): HomePeriod {
  const from =
    range === "TODAY"
      ? today
      : range === "WEEK"
        ? addDays(today, -((weekday(today) - SATURDAY + 7) % 7))
        : monthStart(today);
  const { start, end } = dayRange(from, today, timeZone);
  return { range, from, to: today, start: start!, end: end! };
}

/** The Home screen's period query: today, this week or this month (the default). */
export const homeRangeSchema = z.object({
  range: z.enum(HOME_RANGES).default(DEFAULT_HOME_RANGE),
});

// --- Top bar -----------------------------------------------------------------------------

/** What is on this person's list for today: the Planner's agenda, today's and overdue. */
async function pendingToday(ctx: CompanyContext, now: Date) {
  const agenda = await upcoming(ctx, { days: 1 }, now);
  const today = agenda.days[0]?.items.length ?? 0;
  return { total: agenda.overdue.length + today, overdue: agenda.overdue.length };
}

/** The target that applies to a month: its own, or the latest earlier one. */
async function targetFor(ctx: CompanyContext, month: string) {
  return ctx.db.salesTarget.findFirst({
    where: { month: { lte: dateColumn(`${month}-01`) } },
    orderBy: { month: "desc" },
    select: { month: true, amount: true },
  });
}

/** Who may set the monthly sales target: the owner, or a role with the company settings. */
export const canSetSalesTarget = (ctx: Pick<CompanyContext, "can">) => ctx.can("company.settings");

/**
 * The month's sales against its target, and whether the month is on pace: the
 * share of the target a steady month would have reached by the end of today.
 */
async function monthTarget(ctx: CompanyContext, today: string) {
  const month = today.slice(0, 7);
  const first = monthStart(today);
  const last = monthEnd(today);
  const { start, end } = dayRange(first, last, ctx.company.timezone);
  const [target, sold] = await Promise.all([
    targetFor(ctx, month),
    salesTotals(ctx.company.id, { start: start!, end: end! }),
  ]);
  const daysInMonth = daysBetween(first, last) + 1;
  const daysGone = daysBetween(first, today) + 1;
  const daysLeft = daysInMonth - daysGone + 1;
  const achieved = sold.net;
  let progress = null;
  if (target && target.amount.gt(0)) {
    const amount = new Prisma.Decimal(target.amount);
    const percent = achieved.dividedBy(amount).times(100);
    const expected = amount.times(daysGone).dividedBy(daysInMonth);
    const left = Prisma.Decimal.max(amount.minus(achieved), ZERO);
    progress = {
      amount: amount.toFixed(2),
      /** The month it was set for: an earlier month when carried over. */
      setFor: dateOnly(target.month).slice(0, 7),
      percent: Math.floor(percent.toNumber()),
      reached: achieved.gte(amount),
      onPace: achieved.gte(expected),
      /** The share of the month gone, today included. */
      monthGonePct: Math.round((daysGone / daysInMonth) * 100),
      left: left.toFixed(2),
      /** What each day left (today included) would need to sell to reach it. */
      perDayLeft: money(left.dividedBy(daysLeft)).toFixed(2),
    };
  }
  return {
    month,
    achieved: achieved.toFixed(2),
    invoices: sold.orders,
    daysLeft,
    target: progress,
    canSet: canSetSalesTarget(ctx),
  };
}

/**
 * The Home screen's top bar: today's pending tasks for everyone, and the month's
 * sales against the target for people who see sales amounts.
 */
export async function getHomeTopBar(ctx: CompanyContext, now: Date = new Date()) {
  const today = localDay(now, ctx.company.timezone);
  const [pending, target] = await Promise.all([
    pendingToday(ctx, now),
    canSeeSalesAmounts(ctx) ? monthTarget(ctx, today) : null,
  ]);
  return { today, currency: ctx.company.currency, pending, salesTarget: target };
}

export type HomeTopBar = Awaited<ReturnType<typeof getHomeTopBar>>;

// --- Setting the target ------------------------------------------------------------------

const targetSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month."),
  amount: z
    .number()
    .max(100_000_000_000, "That is more than the app can hold.")
    .multipleOf(0.01)
    .refine((v) => v > 0, "Must be more than zero"),
});

/**
 * Sets the sales target for a month (company.settings). Months after it with no
 * target of their own use this one, so it is set once and changed when needed.
 */
export async function setSalesTarget(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  if (!canSetSalesTarget(ctx)) {
    throw new AppError("FORBIDDEN", "Only the owner can set the monthly sales target.");
  }
  const input = targetSchema.parse(raw);
  const today = localDay(new Date(), ctx.company.timezone);
  if (input.month < today.slice(0, 7)) {
    throw new AppError("VALIDATION", "Choose this month or a later one.", {
      month: ["A month that has passed keeps the target it had."],
    });
  }
  const month = dateColumn(`${input.month}-01`);
  const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
  return prisma.$transaction(async (tx) => {
    const before = await tx.salesTarget.findUnique({
      where: { companyId_month: { companyId: ctx.company.id, month } },
      select: { amount: true },
    });
    const saved = await tx.salesTarget.upsert({
      where: { companyId_month: { companyId: ctx.company.id, month } },
      create: { companyId: ctx.company.id, month, amount, setById: ctx.user.id },
      update: { amount, setById: ctx.user.id },
      select: { id: true, month: true, amount: true },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: before ? "UPDATE" : "CREATE",
        entityType: "SalesTarget",
        entityId: saved.id,
        summary: `Monthly sales target for ${input.month}: ${amount.toFixed(2)}${
          before ? ` (was ${new Prisma.Decimal(before.amount).toFixed(2)})` : ""
        }`,
      },
      tx,
    );
    return { month: input.month, amount: saved.amount.toFixed(2) };
  });
}

// --- The Pulse ---------------------------------------------------------------------------

/** Orders whose goods have not all gone out yet. */
const WAITING_TO_GO = ["CONFIRMED", "PROCESSING", "PACKED"] as const;

/** Sales after discounts and the money collected from buyers in the period. */
async function salesPulse(ctx: CompanyContext, period: HomePeriod) {
  const range = { gte: period.start, lt: period.end };
  const [sold, received, paidBack] = await Promise.all([
    salesTotals(ctx.company.id, { start: period.start, end: period.end }),
    ctx.db.payment.aggregate({
      where: { direction: "RECEIVED", paymentDate: range },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    // Only refunds paid back move money, as on the Payments tab.
    ctx.db.refund.aggregate({
      where: { kind: "CASH", voidedAt: null, refundDate: range },
      _sum: { amount: true },
    }),
  ]);
  const refunded = money(paidBack._sum.amount ?? 0);
  return {
    net: sold.net.toFixed(2),
    invoices: sold.orders,
    pieces: sold.pieces,
    collected: money(received._sum.amount ?? 0)
      .minus(refunded)
      .toFixed(2),
    receipts: received._count._all,
    refunded: refunded.toFixed(2),
  };
}

/** Challans that went out in the period, and the orders still waiting to go. */
async function deliveryPulse(ctx: CompanyContext, period: HomePeriod, today: string) {
  const [challans, pieces, waiting, late] = await Promise.all([
    ctx.db.deliveryChallan.count({
      where: { deliveryDate: { gte: period.start, lt: period.end } },
    }),
    ctx.db.deliveryChallanItem.aggregate({
      where: {
        challan: {
          companyId: ctx.company.id,
          deliveryDate: { gte: period.start, lt: period.end },
        },
      },
      _sum: { quantity: true },
    }),
    ctx.db.salesOrder.count({ where: { status: { in: [...WAITING_TO_GO] } } }),
    ctx.db.salesOrder.count({
      where: { status: { in: [...WAITING_TO_GO] }, shipmentDate: { lt: dateColumn(today) } },
    }),
  ]);
  return { challans, pieces: pieces._sum.quantity ?? 0, waiting, late };
}

/** Production projects running now, and those finished in the period. */
async function productionPulse(ctx: CompanyContext, period: HomePeriod) {
  const dayStart = dayRange(period.to, undefined, ctx.company.timezone).start!;
  const [byStatus, late, completed] = await Promise.all([
    ctx.db.productionProject.groupBy({
      by: ["status"],
      where: { status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } },
      _count: { _all: true },
    }),
    ctx.db.productionProject.count({
      where: { status: "ACTIVE", targetDate: { lt: dayStart } },
    }),
    ctx.db.productionProject.count({
      where: { status: "COMPLETED", completedAt: { gte: period.start, lt: period.end } },
    }),
  ]);
  const count = (status: string) => byStatus.find((r) => r.status === status)?._count._all ?? 0;
  return {
    active: count("ACTIVE"),
    planned: count("PLANNED"),
    onHold: count("ON_HOLD"),
    late,
    completed,
  };
}

/** Who sees which Pulse card. */
export function pulseAccess(ctx: Pick<CompanyContext, "can">) {
  return {
    sales: canSeeSalesAmounts(ctx),
    deliveries: ctx.can("sales.view"),
    production: ctx.can("production.view") || canSeeFinancials(ctx),
  };
}

/**
 * The Pulse: sales and money collected, deliveries, and production, for today,
 * this week or this month. A card someone may not see comes back as null.
 */
export async function getHomePulse(ctx: CompanyContext, raw: unknown = {}, now = new Date()) {
  const { range } = homeRangeSchema.parse(raw);
  const tz = ctx.company.timezone;
  const today = localDay(now, tz);
  const period = homePeriod(range, today, tz);
  const can = pulseAccess(ctx);
  const [sales, deliveries, production] = await Promise.all([
    can.sales ? salesPulse(ctx, period) : null,
    can.deliveries ? deliveryPulse(ctx, period, today) : null,
    can.production ? productionPulse(ctx, period) : null,
  ]);
  return {
    range,
    from: period.from,
    to: period.to,
    currency: ctx.company.currency,
    sales,
    deliveries,
    production,
  };
}

export type HomePulse = Awaited<ReturnType<typeof getHomePulse>>;
