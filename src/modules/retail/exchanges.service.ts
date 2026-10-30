import { Prisma, type RetailExchangeState } from "@prisma/client";

import { addDays, dateColumn, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany, recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { receiveAtCostTx } from "@/modules/inventory/stock.service";

/*
 * A retail store's exchanges (plan v6 sec 8.9, site-changes 2.10). The new
 * piece goes out on its own order at 0, so nothing is billed when it leaves;
 * every money step is its own entry on the store's account, one per piece:
 *   old piece back and approved    only the difference (Exchange extra or
 *                                  Exchange adjustment), the old piece back in stock
 *   old piece back and declined    the new piece in full; the old one stays the store's
 *   old piece not back in time     the new piece in full, the night after the deadline
 *   back after that and approved   the old piece credited at the price paid for it
 *   exchange parcel refused        nothing; a declined (damaged, missing) new
 *                                  piece is billed in full as the store's loss
 * Each exchange settles on its own, so a chain adds up: 650 -> 700 -> 720 bills
 * 650 + 50 + 20.
 */

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => Number(value.toFixed(2));

/** Lines whose exchange is still open: their new piece may still be billed. */
export const OPEN_STATES: readonly RetailExchangeState[] = [
  "WAITING_DELIVERY",
  "WAITING_RETURN",
  "RETURNED_WAITING_CHECK",
];

// ---------------------------------------------------------------------------
// Placing an exchange
// ---------------------------------------------------------------------------

/** How many pieces of a line the customer has (delivered, kept, not exchanged away). */
function withCustomer(
  line: Prisma.RetailOrderLineGetPayload<{
    include: { order: { include: { delivery: true } }; replacedBy: true };
  }>,
) {
  const delivery = line.order.delivery;
  if (!delivery) return 0;
  // An exchange's own new piece is with the customer once its parcel was kept.
  if (line.exchangeState === "WAITING_DELIVERY" || line.exchangeState === "CANCELLED") return 0;
  const returning = Array.isArray(delivery.returning) ? (delivery.returning as string[]) : [];
  const back = returning.filter((id) => id === line.id).length;
  const kept = delivery.status === "RETURNED" ? 0 : line.quantity - back;
  const exchanged = line.replacedBy
    .filter((l) => l.exchangeState !== "CANCELLED")
    .reduce((sum, l) => sum + l.quantity, 0);
  return Math.max(kept - exchanged, 0);
}

export class ExchangeRefusal extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly code: "NOT_FOUND" | "LINE_NOT_DELIVERED" | "EXCHANGE_OPEN",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * The lines an exchange order replaces, checked: each old line is on the named
 * order, is with the customer for that many pieces, and has no open exchange.
 */
export async function replacedLines(
  ctx: CompanyContext,
  ofOrderId: string,
  items: Array<{ lineId: string; replacesLineId?: string; quantity: number }>,
) {
  const of = await ctx.db.retailOrder.findUnique({
    where: { orderId: ofOrderId },
    include: {
      lines: { include: { order: { include: { delivery: true } }, replacedBy: true } },
    },
  });
  if (!of) {
    throw new ExchangeRefusal(404, "NOT_FOUND", "The order being exchanged is not this store's.");
  }
  const missing = items.filter((i) => !i.replacesLineId).map((i) => i.lineId);
  if (missing.length > 0) {
    throw new AppError(
      "VALIDATION",
      `Each line of an exchange names the line it replaces: ${missing.join(", ")}.`,
    );
  }
  const byLineId = new Map(of.lines.map((l) => [l.lineId, l]));
  const replaced = new Map<string, (typeof of.lines)[number]>();
  for (const item of items) {
    const old = byLineId.get(item.replacesLineId!);
    if (!old) {
      throw new ExchangeRefusal(
        409,
        "LINE_NOT_DELIVERED",
        `Line ${item.replacesLineId} is not on that order.`,
        {
          lineId: item.replacesLineId,
        },
      );
    }
    if (old.replacedBy.some((l) => l.exchangeState && OPEN_STATES.includes(l.exchangeState))) {
      throw new ExchangeRefusal(
        409,
        "EXCHANGE_OPEN",
        `Line ${old.lineId} already has an exchange that is not settled.`,
        {
          lineId: old.lineId,
        },
      );
    }
    const asked = items
      .filter((i) => i.replacesLineId === old.lineId)
      .reduce((sum, i) => sum + i.quantity, 0);
    if (asked > withCustomer(old)) {
      throw new ExchangeRefusal(
        409,
        "LINE_NOT_DELIVERED",
        `Line ${old.lineId} was not delivered to the customer for that many pieces, or has come back.`,
        { lineId: old.lineId },
      );
    }
    replaced.set(item.lineId, old);
  }
  return { of, replaced };
}

/** The exchange record and its number (EXG-YYYY-NNNNN), with the order already saved. */
export async function createExchangeTx(
  tx: Tx,
  ctx: CompanyContext,
  args: { storeId: string; retailOrderId: string; ofRetailOrderId: string; note: string | null },
) {
  await lockRow(tx, "RetailStore", args.storeId);
  const year = localDay(new Date(), ctx.company.timezone).slice(0, 4);
  const count = await tx.retailExchange.count({
    where: { companyId: ctx.company.id, number: { startsWith: `EXG-${year}-` } },
  });
  return tx.retailExchange.create({
    data: {
      companyId: ctx.company.id,
      storeId: args.storeId,
      number: `EXG-${year}-${String(count + 1).padStart(5, "0")}`,
      retailOrderId: args.retailOrderId,
      ofRetailOrderId: args.ofRetailOrderId,
      note: args.note,
    },
  });
}

// ---------------------------------------------------------------------------
// The exchange parcel's delivery result and the old pieces coming back
// ---------------------------------------------------------------------------

/**
 * The exchange parcel's courier result: kept lines start their deadline, the
 * others (refused) are cancelled. Answers the ERP line ids of the pieces that
 * will come back: the old piece of each kept line, the new piece of the others.
 */
export async function exchangeDeliveredTx(
  tx: Tx,
  ctx: CompanyContext,
  args: {
    exchangeId: string;
    lines: Array<{ id: string; quantity: number; replacesLineId: string | null }>;
    kept: Set<string>;
    at: Date;
    exchangeDays: number;
  },
) {
  const deliveredOn = localDay(args.at, ctx.company.timezone);
  const returning: string[] = [];
  for (const line of args.lines) {
    const kept = args.kept.has(line.id);
    await tx.retailOrderLine.update({
      where: { id: line.id },
      data: kept
        ? {
            exchangeState: "WAITING_RETURN",
            deliveredOn: dateColumn(deliveredOn),
            deadline: dateColumn(addDays(deliveredOn, args.exchangeDays)),
          }
        : { exchangeState: "CANCELLED" },
    });
    if (!kept) {
      await tx.retailExchangeEvent.create({
        data: {
          companyId: ctx.company.id,
          exchangeId: args.exchangeId,
          lineId: line.id,
          type: "CANCELLED",
          amount: ZERO,
        },
      });
    }
    for (let i = 0; i < line.quantity; i++) returning.push(kept ? line.replacesLineId! : line.id);
  }
  await touch(tx, args.exchangeId);
  return returning;
}

/** Cancels the exchange lines of an order cancelled before it left. */
export async function cancelExchangeTx(tx: Tx, ctx: CompanyContext, retailOrderId: string) {
  const exchange = await tx.retailExchange.findUnique({
    where: { retailOrderId },
    include: { order: { include: { lines: true } } },
  });
  if (!exchange) return;
  await touch(tx, exchange.id);
  for (const line of exchange.order.lines) {
    if (line.exchangeState !== "WAITING_DELIVERY") continue;
    await tx.retailOrderLine.update({
      where: { id: line.id },
      data: { exchangeState: "CANCELLED" },
    });
    await tx.retailExchangeEvent.create({
      data: {
        companyId: ctx.company.id,
        exchangeId: exchange.id,
        lineId: line.id,
        type: "CANCELLED",
        amount: ZERO,
      },
    });
  }
}

/**
 * The old pieces reached the courier's return list. Those handed back by the
 * deadline wait for the check; one billed meanwhile (the list came late but
 * shows the piece was back in time) has its bill reversed.
 */
export async function exchangeParcelTx(
  tx: Tx,
  ctx: CompanyContext,
  args: { exchangeId: string; handedBackAt: Date; meta?: RequestMeta },
) {
  const handedBack = args.handedBackAt.toISOString().slice(0, 10);
  const lines = await tx.retailOrderLine.findMany({
    where: { order: { exchange: { id: args.exchangeId } } },
    include: { exchangeEvents: true },
  });
  await touch(tx, args.exchangeId);
  for (const line of lines) {
    const deadline = line.deadline?.toISOString().slice(0, 10);
    const inTime = deadline !== undefined && handedBack <= deadline;
    if (line.exchangeState === "WAITING_RETURN") {
      await tx.retailOrderLine.update({
        where: { id: line.id },
        data: { exchangeState: "RETURNED_WAITING_CHECK" },
      });
    } else if (line.exchangeState === "BILLED" && inTime) {
      const bill = line.exchangeEvents.find(
        (e) => e.type === "BILLED" && e.kind === "DEADLINE_PASSED" && !e.reversesId,
      );
      const reversed = line.exchangeEvents.some((e) => e.reversesId === bill?.id);
      if (!bill || reversed) continue;
      if (bill.journalEntryId) {
        await reverseJournalEntry(tx, bill.journalEntryId, {
          description: `Exchange bill reversed: the old piece was handed back on ${handedBack}, by the deadline`,
          postedById: ctx.user.id,
        });
      }
      await tx.retailExchangeEvent.create({
        data: {
          companyId: ctx.company.id,
          exchangeId: args.exchangeId,
          lineId: line.id,
          type: "BILLED",
          kind: "REVERSED",
          amount: bill.amount.negated(),
          reversesId: bill.id,
        },
      });
      await tx.retailOrderLine.update({
        where: { id: line.id },
        data: { exchangeState: "RETURNED_WAITING_CHECK" },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Money and stock
// ---------------------------------------------------------------------------

/** Marks the exchange changed, so the site's updatedSince poll finds it. */
const touch = (tx: Tx, exchangeId: string) =>
  tx.retailExchange.update({ where: { id: exchangeId }, data: { updatedAt: new Date() } });

/** One money step on the store's account: a positive amount is owed, a negative one comes off. */
async function postExchangeTx(
  tx: Tx,
  args: {
    companyId: string;
    userId?: string;
    partyId: string;
    amount: Prisma.Decimal;
    description: string;
    sourceId: string;
  },
) {
  if (args.amount.isZero()) return null;
  const acc = await ensureControlAccounts(args.companyId, tx);
  const value = args.amount.abs();
  const owed = args.amount.gt(0);
  return postJournalEntry(tx, {
    companyId: args.companyId,
    description: args.description,
    sourceType: "RETAIL_EXCHANGE",
    sourceId: args.sourceId,
    postedById: args.userId,
    lines: [
      {
        accountId: acc.RECEIVABLE,
        partyId: args.partyId,
        ...(owed ? { debit: value } : { credit: value }),
      },
      { accountId: acc.SALES, ...(owed ? { credit: value } : { debit: value }) },
    ],
  });
}

/** A checked piece back into A-grade stock at the cost it left at (that cost back off cost of goods). */
async function restockTx(
  tx: Tx,
  ctx: CompanyContext,
  args: {
    warehouseId: string;
    variantId: string;
    unitCost: Prisma.Decimal;
    pieceId: string;
    note: string;
  },
) {
  await lockRow(tx, "ProductVariant", args.variantId);
  const variant = await tx.productVariant.findUniqueOrThrow({
    where: { id: args.variantId },
    select: { id: true, sku: true, avgCost: true },
  });
  const onHand = await tx.stockBalance.aggregate({
    where: { variantId: variant.id, grade: "A_GRADE" },
    _sum: { quantity: true },
  });
  const key = { variantId: variant.id, warehouseId: args.warehouseId, grade: "A_GRADE" as const };
  await tx.stockBalance.upsert({
    where: { variantId_warehouseId_grade: key },
    create: { ...key, companyId: ctx.company.id, quantity: 1 },
    update: { quantity: { increment: 1 } },
  });
  const movement = await tx.stockMovement.create({
    data: {
      ...key,
      companyId: ctx.company.id,
      type: "RETURN_RESTOCK",
      quantity: 1,
      unitCost: args.unitCost,
      referenceType: "RetailReturnPiece",
      referenceId: args.pieceId,
      note: args.note,
      createdById: ctx.user.id,
    },
  });
  await receiveAtCostTx(tx, ctx, {
    variant,
    grade: "A_GRADE",
    onHand: onHand._sum.quantity ?? 0,
    average: variant.avgCost,
    quantity: 1,
    unitCost: args.unitCost,
    movementId: movement.id,
  });
  if (args.unitCost.gt(0)) {
    const acc = await ensureControlAccounts(ctx.company.id, tx);
    await postJournalEntry(tx, {
      companyId: ctx.company.id,
      description: `Exchange piece back in stock — ${variant.sku}: ${args.note}`,
      sourceType: "RETAIL_EXCHANGE",
      sourceId: args.pieceId,
      postedById: ctx.user.id,
      lines: [
        { accountId: acc.INVENTORY, debit: args.unitCost },
        { accountId: acc.COGS, credit: args.unitCost },
      ],
    });
  }
}

/** The cost a piece of that SKU left the order at. */
async function unitCostOf(tx: Tx, orderId: string, variantId: string) {
  const item = await tx.salesOrderItem.findFirst({ where: { orderId, variantId } });
  return item?.unitCost ?? ZERO;
}

// ---------------------------------------------------------------------------
// The check of an exchange parcel
// ---------------------------------------------------------------------------

export type ExchangeDecision = { pieceId: string; decision: "APPROVE" | "DECLINE" };

/**
 * Settles the checked pieces of an exchange parcel (each claimed already by the
 * check). Runs in one transaction: either every step is saved or none.
 */
export async function settleExchangePieces(
  ctx: CompanyContext,
  parcelId: string,
  decisions: ExchangeDecision[],
  meta?: RequestMeta,
) {
  const summary: string[] = [];
  await runTransaction(async (tx) => {
    const parcel = await tx.retailReturnParcel.findUniqueOrThrow({
      where: { id: parcelId },
      include: {
        list: true,
        order: {
          include: {
            store: true,
            order: { select: { id: true, warehouseId: true } },
            exchange: true,
            lines: { include: { replaces: { include: { order: true } } } },
          },
        },
        pieces: { include: { variant: { select: { sku: true } } } },
      },
    });
    const exchange = parcel.order.exchange!;
    await lockRow(tx, "RetailExchange", exchange.id);
    await touch(tx, exchange.id);
    const store = parcel.order.store;
    const warehouseId = parcel.order.order.warehouseId!;
    for (const d of decisions) {
      const piece = parcel.pieces.find((p) => p.id === d.pieceId)!;
      const line =
        parcel.order.lines.find((l) => l.id === piece.retailOrderLineId) ??
        parcel.order.lines.find((l) => l.replacesLineId === piece.retailOrderLineId)!;
      const fresh = await tx.retailOrderLine.findUniqueOrThrow({ where: { id: line.id } });
      const newPrice = line.shopPrice;
      const oldPrice = piece.price;
      const isNewPiece = piece.retailOrderLineId === line.id;
      const note = `${exchange.number}, ${parcel.list.returnListId} ${parcel.consignmentId}`;
      let event: {
        type: "SETTLED" | "BILLED" | "CREDITED";
        kind: string;
        amount: Prisma.Decimal;
      } | null = null;
      if (isNewPiece) {
        // The refused exchange parcel came back: nothing was billed for it.
        if (d.decision === "APPROVE") {
          await restockTx(tx, ctx, {
            warehouseId,
            variantId: piece.variantId,
            unitCost: await unitCostOf(tx, parcel.order.orderId, piece.variantId),
            pieceId: piece.id,
            note: `${note}: refused exchange piece`,
          });
          summary.push(`${piece.variant.sku} (refused exchange piece) back in stock`);
        } else {
          event = { type: "BILLED", kind: "NEW_PIECE_DECLINED", amount: newPrice };
        }
      } else if (fresh.exchangeState === "BILLED") {
        // Billed when the deadline passed: an approved old piece is credited.
        if (d.decision === "APPROVE") {
          event = { type: "CREDITED", kind: "LATE_RETURN", amount: oldPrice.negated() };
        }
      } else if (d.decision === "APPROVE") {
        const difference = newPrice.minus(oldPrice);
        event = {
          type: "SETTLED",
          kind: difference.gt(0) ? "EXTRA" : difference.lt(0) ? "ADJUSTMENT" : "EVEN",
          amount: difference,
        };
      } else {
        event = { type: "BILLED", kind: "OLD_PIECE_DECLINED", amount: newPrice };
      }
      if (!isNewPiece && d.decision === "APPROVE") {
        await restockTx(tx, ctx, {
          warehouseId,
          variantId: piece.variantId,
          unitCost: await unitCostOf(tx, line.replaces!.order.orderId, piece.variantId),
          pieceId: piece.id,
          note: `${note}: old piece`,
        });
      }
      if (event) {
        const journal = await postExchangeTx(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          partyId: store.partyId,
          amount: event.amount,
          description: `${exchangeLabel(event.type, event.kind)} ${exchange.number} — ${piece.variant.sku}`,
          sourceId: exchange.id,
        });
        await tx.retailExchangeEvent.create({
          data: {
            companyId: ctx.company.id,
            exchangeId: exchange.id,
            lineId: line.id,
            type: event.type,
            kind: event.kind,
            amount: event.amount,
            journalEntryId: journal?.id ?? null,
          },
        });
        summary.push(`${exchangeLabel(event.type, event.kind)} ${money(event.amount)}`);
      }
      // The line is done once none of its pieces waits for the check.
      const waiting = await tx.retailReturnPiece.count({
        where: {
          parcelId: parcel.id,
          status: "WAITING",
          retailOrderLineId: { in: [line.id, line.replacesLineId ?? line.id] },
        },
      });
      if (waiting === 0 && event) {
        await tx.retailOrderLine.update({
          where: { id: line.id },
          data: { exchangeState: event.type },
        });
      }
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "RetailExchange",
        entityId: exchange.id,
        summary: `${exchange.number} checked: ${summary.join("; ") || "no money moved"}`,
      },
      tx,
    );
  });
}

const exchangeLabel = (type: string, kind: string | null) =>
  type === "SETTLED"
    ? kind === "EXTRA"
      ? "Exchange extra"
      : kind === "ADJUSTMENT"
        ? "Exchange adjustment"
        : "Exchange settled even"
    : type === "BILLED"
      ? kind === "REVERSED"
        ? "Exchange bill reversed"
        : "Exchange billed in full"
      : type === "CREDITED"
        ? "Exchange credit"
        : "Exchange cancelled";

// ---------------------------------------------------------------------------
// The nightly bill for old pieces that did not come back
// ---------------------------------------------------------------------------

/**
 * Every exchange whose old piece is not back by the end of its deadline (the
 * company's own day) is billed in full. Safe to repeat: a line billed once is
 * not waiting any more.
 */
export async function billOverdueExchanges(now: Date = new Date()) {
  const lines = await prisma.retailOrderLine.findMany({
    where: { exchangeState: "WAITING_RETURN", deadline: { not: null } },
    include: {
      company: { select: { id: true, timezone: true } },
      order: { include: { exchange: true, store: true } },
      variant: { select: { sku: true } },
    },
  });
  let billed = 0;
  for (const line of lines) {
    const today = localDay(now, line.company.timezone);
    if (line.deadline!.toISOString().slice(0, 10) >= today) continue;
    const exchange = line.order.exchange;
    if (!exchange) continue;
    const amount = line.shopPrice.times(line.quantity);
    await runTransaction(async (tx) => {
      await lockRow(tx, "RetailExchange", exchange.id);
      const claimed = await tx.retailOrderLine.updateMany({
        where: { id: line.id, exchangeState: "WAITING_RETURN" },
        data: { exchangeState: "BILLED" },
      });
      if (claimed.count !== 1) return;
      await touch(tx, exchange.id);
      const journal = await postExchangeTx(tx, {
        companyId: line.companyId,
        partyId: line.order.store.partyId,
        amount,
        description: `Exchange billed in full ${exchange.number} — ${line.variant.sku}: the old piece did not come back by ${line.deadline!.toISOString().slice(0, 10)}`,
        sourceId: exchange.id,
      });
      await tx.retailExchangeEvent.create({
        data: {
          companyId: line.companyId,
          exchangeId: exchange.id,
          lineId: line.id,
          type: "BILLED",
          kind: "DEADLINE_PASSED",
          amount,
          journalEntryId: journal?.id ?? null,
        },
      });
      await recordAudit(
        {
          companyId: line.companyId,
          userId: null,
          action: "UPDATE",
          entityType: "RetailExchange",
          entityId: exchange.id,
          summary: `${exchange.number}: the old piece of ${line.lineId} did not come back in time; the new piece billed in full (${amount.toFixed(2)})`,
        },
        tx,
      );
      billed += 1;
    });
  }
  return billed;
}

// ---------------------------------------------------------------------------
// What is waiting
// ---------------------------------------------------------------------------

/** The full value of the new pieces that may still be billed (not part of the balance). */
export async function exchangesAtRiskOf(ctx: CompanyContext, storeId: string) {
  const lines = await ctx.db.retailOrderLine.findMany({
    where: { order: { storeId }, exchangeState: { in: [...OPEN_STATES] } },
    select: { shopPrice: true, quantity: true },
  });
  return lines.reduce((sum, l) => sum.plus(l.shopPrice.times(l.quantity)), ZERO);
}

/** The exchange's status for the site: the least finished of its lines. */
export function exchangeStatus(states: Array<RetailExchangeState | null>) {
  for (const s of OPEN_STATES) if (states.includes(s)) return s;
  for (const s of ["BILLED", "CREDITED", "SETTLED"] as const) if (states.includes(s)) return s;
  return "CANCELLED" as const;
}
