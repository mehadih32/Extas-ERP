import { Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { ensureWalkInParty } from "@/modules/parties/walk-in";
import { invoiceStatusFor, money, ZERO } from "@/modules/sales/totals";

/*
 * How sales reach the books (and so every buyer's ledger):
 *   Payment before the invoice  Dr Cash/Bank/Wallet   Cr Customer Advance (buyer)
 *   Invoice                     Dr Receivable (buyer) Cr Sales / Delivery income / VAT
 *     + advance applied         Dr Customer Advance   Cr Receivable (buyer)
 *   Payment after the invoice   Dr Cash/Bank/Wallet   Cr Receivable (buyer)
 *   Delivery                    Dr Cost of Goods Sold Cr Inventory (at average cost)
 *   Refund (see refund.service) Dr Customer Advance   Cr Cash / Receivable / Other Income
 *
 * What an order or proforma holds is what was received on it less its refunds
 * that are not void: that is its paid amount. The receivable and advance lines
 * of an order without a buyer name the Walk-in customers account
 * (parties/walk-in.ts).
 */

type Tx = Prisma.TransactionClient;

async function refundedOn(db: Db, where: { orderId: string } | { proformaId: string }) {
  const agg = await db.refund.aggregate({
    where: { ...where, voidedAt: null },
    _sum: { amount: true },
  });
  return money(agg._sum.amount ?? 0);
}

/** Money held on an order: received on it less its refunds that are not void. */
export async function heldOnOrder(db: Db, orderId: string) {
  const agg = await db.payment.aggregate({
    where: { orderId, direction: "RECEIVED" },
    _sum: { amount: true },
  });
  return money(agg._sum.amount ?? 0).minus(await refundedOn(db, { orderId }));
}

/** Money held on a proforma: advances received on it less its refunds that are not void. */
export async function heldOnProforma(db: Db, proformaId: string) {
  const agg = await db.payment.aggregate({
    where: { proformaId, direction: "RECEIVED" },
    _sum: { amount: true },
  });
  return money(agg._sum.amount ?? 0).minus(await refundedOn(db, { proformaId }));
}

/** Re-totals what has been paid against an order and its invoice. */
export async function refreshOrderPayments(tx: Tx, orderId: string) {
  const order = await tx.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { invoice: true },
  });
  const paid = await heldOnOrder(tx, orderId);
  await tx.salesOrder.update({
    where: { id: order.id },
    data: {
      paidAmount: paid,
      dueAmount:
        order.status === "CANCELLED" ? ZERO : Prisma.Decimal.max(order.total.minus(paid), ZERO),
    },
  });
  if (order.invoice && order.invoice.status !== "VOID") {
    await tx.invoice.update({
      where: { id: order.invoice.id },
      data: {
        paidAmount: paid,
        dueAmount: Prisma.Decimal.max(order.invoice.total.minus(paid), ZERO),
        status: invoiceStatusFor(order.invoice.total, paid),
      },
    });
  }
  return paid;
}

/** Re-totals the advance paid on a proforma; returns the updated proforma. */
export async function refreshProformaPayments(tx: Tx, proformaId: string) {
  return tx.proformaInvoice.update({
    where: { id: proformaId },
    data: { advancePaid: await heldOnProforma(tx, proformaId) },
  });
}

/**
 * Advances sitting on the order (paid before it was invoiced), less refunds:
 * money is only refunded while the order has no live invoice, so every
 * refund came out of its advances.
 */
export async function advanceHeld(tx: Tx, orderId: string) {
  const agg = await tx.payment.aggregate({
    where: { orderId, direction: "RECEIVED", isAdvance: true },
    _sum: { amount: true },
  });
  return Prisma.Decimal.max(
    money(agg._sum.amount ?? 0).minus(await refundedOn(tx, { orderId })),
    ZERO,
  );
}

/** The account a sale's receivable and advance lines name: its buyer, or Walk-in customers. */
export async function ledgerPartyId(tx: Tx, companyId: string, partyId: string | null) {
  return partyId ?? ensureWalkInParty(companyId, tx);
}

/** Revenue entry for an invoice, applying any advance already received. */
export async function postInvoice(
  tx: Tx,
  args: {
    companyId: string;
    userId: string;
    invoice: { id: string; number: string; issueDate: Date };
    order: {
      id: string;
      partyId: string | null;
      subtotal: Prisma.Decimal;
      discount: Prisma.Decimal;
      shippingCharge: Prisma.Decimal;
      tax: Prisma.Decimal;
      total: Prisma.Decimal;
    };
    partyName: string;
  },
) {
  const { order } = args;
  if (order.total.isZero()) return null;
  const acc = await ensureControlAccounts(args.companyId, tx);
  const partyId = await ledgerPartyId(tx, args.companyId, order.partyId);
  const applied = Prisma.Decimal.min(await advanceHeld(tx, order.id), order.total);
  return postJournalEntry(tx, {
    companyId: args.companyId,
    date: args.invoice.issueDate,
    description: `Invoice ${args.invoice.number} — ${args.partyName}`,
    sourceType: "SALE",
    sourceId: args.invoice.id,
    postedById: args.userId,
    lines: [
      { accountId: acc.RECEIVABLE, partyId, debit: order.total },
      { accountId: acc.SALES, credit: order.subtotal.minus(order.discount) },
      { accountId: acc.DELIVERY_INCOME, credit: order.shippingCharge },
      { accountId: acc.VAT_PAYABLE, credit: order.tax },
      { accountId: acc.CUSTOMER_ADVANCE, partyId, debit: applied, memo: "Advance applied" },
      { accountId: acc.RECEIVABLE, partyId, credit: applied, memo: "Advance applied" },
    ],
  });
}

/** Cost of the goods that left the warehouse. */
export async function postCostOfSales(
  tx: Tx,
  args: {
    companyId: string;
    userId: string;
    sourceId: string;
    description: string;
    date: Date;
    cost: Prisma.Decimal;
  },
) {
  const cost = money(args.cost);
  if (cost.lte(0)) return null; // SKUs without a recorded cost yet
  const acc = await ensureControlAccounts(args.companyId, tx);
  return postJournalEntry(tx, {
    companyId: args.companyId,
    date: args.date,
    description: args.description,
    sourceType: "SALE",
    sourceId: args.sourceId,
    postedById: args.userId,
    lines: [
      { accountId: acc.COGS, debit: cost },
      { accountId: acc.INVENTORY, credit: cost },
    ],
  });
}
