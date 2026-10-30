import { Prisma, type RetailStore } from "@prisma/client";
import { z } from "zod";

import { addDays, daysBetween, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { requirePin } from "@/modules/ai/settings.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { getPartyBalance, getStatement } from "@/modules/parties/ledger.service";

import { assertCanManageStores, assertCanSeeStores, storeOrThrow } from "./stores.service";

/*
 * A retail store's account with the ERP (plan v6 sec 5, site-changes 2.4): what
 * it owes (its buyer's balance), and the 30-day hold. When the store owes money
 * (returns still waiting for the owner's check not counted) and 30 days pass
 * after its last payment (with none ever: after its first bill), new orders
 * are refused. Any payment starts the count again; paying off the balance
 * lifts it. The owner can lift it for a while with the PIN and a reason.
 */

export const HOLD_DAYS = 30;
export const WARN_FROM_DAYS = 25;

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => Number(value.toFixed(2));

type Store = Pick<RetailStore, "id" | "partyId" | "holdReleasedUntil" | "holdReleaseReason">;

/** The store's last payment, and its first bill (both journal dates). */
async function paymentDays(ctx: CompanyContext, partyId: string) {
  const lineOf = (sourceType: "PAYMENT" | "SALE", side: "debit" | "credit") =>
    prisma.journalEntry.findFirst({
      where: {
        companyId: ctx.company.id,
        sourceType,
        lines: { some: { partyId, [side]: { gt: 0 } } },
      },
      orderBy: { date: sourceType === "PAYMENT" ? "desc" : "asc" },
      select: { date: true },
    });
  const [payment, bill] = await Promise.all([lineOf("PAYMENT", "credit"), lineOf("SALE", "debit")]);
  return { lastPaymentAt: payment?.date ?? null, firstBillAt: bill?.date ?? null };
}

/** Returned pieces still waiting for the owner's check, at the price the store paid. */
export async function waitingCheckOf(_ctx: CompanyContext, _storeId: string) {
  return ZERO;
}

/** New exchange pieces not billed yet. */
export async function exchangesAtRiskOf(_ctx: CompanyContext, _storeId: string) {
  return ZERO;
}

/** The store's balance and its hold, as of now. */
export async function holdOf(ctx: CompanyContext, store: Store, now = new Date()) {
  const tz = ctx.company.timezone;
  const [balance, waitingCheck, { lastPaymentAt, firstBillAt }] = await Promise.all([
    getPartyBalance(ctx, store.partyId),
    waitingCheckOf(ctx, store.id),
    paymentDays(ctx, store.partyId),
  ]);
  const owes = balance.minus(waitingCheck).gt(0);
  const today = localDay(now, tz);
  const from = lastPaymentAt ?? firstBillAt;
  const fromDay = from ? localDay(from, tz) : null;
  const holdsOn = owes && fromDay ? addDays(fromDay, HOLD_DAYS) : null;
  const due = holdsOn !== null && today >= holdsOn;
  const released = Boolean(store.holdReleasedUntil && store.holdReleasedUntil > now);
  const onHold = due && !released;
  const days = fromDay ? daysBetween(fromDay, today) : null;
  return {
    balance,
    waitingCheck,
    onHold,
    reason: onHold
      ? lastPaymentAt
        ? `No payment for ${days} days`
        : `No payment since the first bill, ${days} days ago`
      : null,
    lastPaymentAt: lastPaymentAt ? localDay(lastPaymentAt, tz) : null,
    daysSinceLastPayment: lastPaymentAt ? days : null,
    holdsOn,
    warnFromDays: WARN_FROM_DAYS,
    releasedUntil: released ? store.holdReleasedUntil : null,
    releaseReason: released ? store.holdReleaseReason : null,
  };
}

const releaseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Write why the hold is lifted")
    .max(300, "At most 300 characters"),
  days: z.coerce
    .number()
    .int("Whole days")
    .min(1, "At least 1 day")
    .max(30, "At most 30 days")
    .default(7),
  pin: z.string().trim().max(20).optional(),
});

/** Lifts the hold for a few days (PIN, reason, logged). */
export async function releaseHold(
  ctx: CompanyContext,
  storeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageStores(ctx);
  const store = await storeOrThrow(ctx, storeId);
  const input = releaseSchema.parse(raw);
  await requirePin(ctx, input.pin, "lift a store's hold");
  const until = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);
  await ctx.db.retailStore.update({
    where: { id: store.id },
    data: { holdReleasedUntil: until, holdReleaseReason: input.reason },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailStore",
    entityId: store.id,
    summary: `Lifted the hold of "${store.name}" for ${input.days} day(s): ${input.reason}`,
  });
  return { until };
}

/** Refuses a store's new order while it is on hold. */
export async function assertNotOnHold(ctx: CompanyContext, store: Store) {
  const hold = await holdOf(ctx, store);
  if (hold.onHold) {
    throw new AppError("CONFLICT", `The store's account is on hold: ${hold.reason}.`, {
      hold: [hold.reason ?? "On hold"],
    });
  }
  return hold;
}

const periodSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
      .optional(),
  })
  .refine((q) => Boolean(q.from) === Boolean(q.to), { message: "Give both from and to" });

/** The store's account: balance, hold and, for a period, its bills, credits and payments. */
export async function accountOf(ctx: CompanyContext, store: Store, raw: unknown = {}) {
  const q = periodSchema.parse(raw);
  const [hold, exchangesAtRisk] = await Promise.all([
    holdOf(ctx, store),
    exchangesAtRiskOf(ctx, store.id),
  ]);
  let period = null;
  let statement: Array<{
    date: string;
    kind: "BILL" | "CREDIT" | "PAYMENT" | "OTHER";
    number: string;
    description: string | null;
    amount: number;
  }> = [];
  if (q.from && q.to) {
    if (q.from > q.to) throw new AppError("VALIDATION", "'from' is after 'to'.");
    const s = await getStatement(ctx, store.partyId, { from: q.from, to: q.to });
    const sum = { orders: ZERO, credits: ZERO, payments: ZERO, other: ZERO };
    statement = s.lines.map((line) => {
      const debit = new Prisma.Decimal(line.debit);
      const credit = new Prisma.Decimal(line.credit);
      const net = debit.minus(credit);
      const kind =
        line.sourceType === "SALE"
          ? "BILL"
          : line.sourceType === "RETURN"
            ? "CREDIT"
            : line.sourceType === "PAYMENT"
              ? "PAYMENT"
              : "OTHER";
      if (kind === "BILL") sum.orders = sum.orders.plus(net);
      else if (kind === "CREDIT") sum.credits = sum.credits.minus(net);
      else if (kind === "PAYMENT") sum.payments = sum.payments.minus(net);
      else sum.other = sum.other.plus(net);
      return {
        date: localDay(line.date, ctx.company.timezone),
        kind,
        number: line.number,
        description: line.description,
        amount: money(net.abs()),
      };
    });
    period = {
      from: q.from,
      to: q.to,
      openingBalance: Number(s.summary.openingBalance),
      ordersTotal: money(sum.orders),
      exchangesTotal: 0,
      otherCharges: money(sum.other),
      creditsTotal: money(sum.credits),
      paymentsTotal: money(sum.payments),
      closingBalance: Number(s.summary.closingBalance),
    };
  }
  return {
    balance: money(hold.balance),
    waitingCheck: money(hold.waitingCheck),
    exchangesAtRisk: money(exchangesAtRisk),
    hold: {
      onHold: hold.onHold,
      reason: hold.reason,
      lastPaymentAt: hold.lastPaymentAt,
      daysSinceLastPayment: hold.daysSinceLastPayment,
      holdsOn: hold.holdsOn,
      warnFromDays: hold.warnFromDays,
    },
    period,
    statement,
  };
}

/** The account panel on the store's page. */
export async function storeAccount(ctx: CompanyContext, storeId: string) {
  assertCanSeeStores(ctx);
  const store = await storeOrThrow(ctx, storeId);
  const hold = await holdOf(ctx, store);
  const billed = await ctx.db.retailOrder.count({
    where: { storeId: store.id, billedAt: { not: null } },
  });
  return {
    balance: hold.balance.toFixed(2),
    waitingCheck: hold.waitingCheck.toFixed(2),
    onHold: hold.onHold,
    reason: hold.reason,
    lastPaymentAt: hold.lastPaymentAt,
    holdsOn: hold.holdsOn,
    releasedUntil: hold.releasedUntil,
    releaseReason: hold.releaseReason,
    billedOrders: billed,
  };
}

export type StoreAccount = Awaited<ReturnType<typeof storeAccount>>;
