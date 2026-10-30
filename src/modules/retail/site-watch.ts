import { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { ownerStandIn } from "@/modules/bug-guard/owner";

import { holdOf } from "./account.service";
import { shopEventTx } from "./shop-events";

/*
 * With the shop clock (every minute): what changed on a store's account that
 * its site should hear without asking (site-changes 2.8).
 *   payment.recorded   Accounts recorded money from the store (or reversed a
 *                      payment: the same event with `reverses`). Its eventId
 *                      is the payment's journal entry, so it is made once.
 *   account.hold       the store went on hold; account.released when it no
 *                      longer is (a payment came, or the owner lifted it).
 * Only for a store whose online shop has a webhook address; GET /account
 * shows the same at any time.
 */

const OVERLAP_MS = 10 * 60_000;

export async function retailSiteWatch(now: Date = new Date()) {
  const stores = await prisma.retailStore.findMany({
    where: { integration: { isActive: true, webhookUrl: { not: null } } },
  });
  let told = 0;
  for (const store of stores) {
    const ctx = await ownerStandIn(store.companyId, null, "Retail site notices");
    if (!ctx) continue;
    told += await paymentsTold(store, ctx.company.timezone, now);
    const hold = await holdOf(ctx, store, now);
    if (hold.onHold !== store.holdTold) {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.retailStore.updateMany({
          where: { id: store.id, holdTold: store.holdTold },
          data: { holdTold: hold.onHold },
        });
        if (claimed.count !== 1) return;
        await shopEventTx(
          tx,
          store.id,
          hold.onHold ? "account.hold" : "account.released",
          {
            balance: Number(hold.balance.toFixed(2)),
            waitingCheck: Number(hold.waitingCheck.toFixed(2)),
            reason: hold.reason,
            lastPaymentAt: hold.lastPaymentAt,
            releasedUntil: hold.releasedUntil?.toISOString() ?? null,
          },
          { now },
        );
      });
      told++;
    }
  }
  return told;
}

/** Payments (and reversed payments) from the store since the last pass. */
async function paymentsTold(
  store: { id: string; companyId: string; partyId: string; paymentToldAt: Date | null },
  timeZone: string,
  now: Date,
) {
  // The first pass only sets the place: payments from before the shop had webhooks were read by GET /account.
  if (!store.paymentToldAt) {
    await prisma.retailStore.update({ where: { id: store.id }, data: { paymentToldAt: now } });
    return 0;
  }
  const entries = await prisma.journalEntry.findMany({
    where: {
      companyId: store.companyId,
      sourceType: "PAYMENT",
      // A little before the place too: a payment saved late is still told (each id once).
      createdAt: { gt: new Date(store.paymentToldAt.getTime() - OVERLAP_MS), lte: now },
      lines: { some: { partyId: store.partyId } },
    },
    include: { lines: { where: { partyId: store.partyId } } },
    orderBy: { createdAt: "asc" },
  });
  let told = 0;
  for (const e of entries) {
    // Money in from the store is a credit on its line; a reversal is the same entry turned round.
    const amount = e.lines.reduce(
      (sum, l) => sum.plus(l.credit).minus(l.debit),
      new Prisma.Decimal(0),
    );
    // Only money in from the store, or a reversal of it.
    if (e.reversalOfId ? !amount.lt(0) : !amount.gt(0)) continue;
    try {
      await prisma.$transaction((tx) =>
        shopEventTx(
          tx,
          store.id,
          "payment.recorded",
          {
            paymentId: e.reversalOfId ?? e.id,
            number: e.number,
            date: localDay(e.date, timeZone),
            amount: Number(amount.toFixed(2)),
            ...(e.reversalOfId ? { reverses: e.reversalOfId } : {}),
          },
          { id: e.id, now },
        ),
      );
      told++;
    } catch (error) {
      // Told already (a pass that stopped half way): the same id is never sent twice.
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  const last = entries.at(-1)?.createdAt ?? null;
  if (last && last > store.paymentToldAt)
    await prisma.retailStore.update({ where: { id: store.id }, data: { paymentToldAt: last } });
  return told;
}
