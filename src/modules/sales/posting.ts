import { Prisma } from "@prisma/client";

import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { invoiceStatusFor, money, ZERO } from "@/modules/sales/totals";

/*
 * How sales reach the books (and so every buyer's ledger):
 *   Payment before the invoice  Dr Cash/Bank/Wallet   Cr Customer Advance (buyer)
 *   Invoice                     Dr Receivable (buyer) Cr Sales / Delivery income / VAT
 *     + advance applied         Dr Customer Advance   Cr Receivable (buyer)
 *   Payment after the invoice   Dr Cash/Bank/Wallet   Cr Receivable (buyer)
 *   Delivery                    Dr Cost of Goods Sold Cr Inventory (at average cost)
 */

type Tx = Prisma.TransactionClient;

/** Locks a sales document row until the transaction ends (no double payments / deliveries). */
export async function lockRow(
  tx: Tx,
  table: "SalesOrder" | "ProformaInvoice" | "Quotation",
  id: string,
) {
  await tx.$queryRaw`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} FOR UPDATE`;
}

/** Re-totals what has been paid against an order and its invoice. */
export async function refreshOrderPayments(tx: Tx, orderId: string) {
  const order = await tx.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { invoice: true },
  });
  const agg = await tx.payment.aggregate({
    where: { orderId, direction: "RECEIVED" },
    _sum: { amount: true },
  });
  const paid = money(agg._sum.amount ?? 0);
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

/** Advances sitting on the order (paid before it was invoiced). */
export async function advanceHeld(tx: Tx, orderId: string) {
  const agg = await tx.payment.aggregate({
    where: { orderId, direction: "RECEIVED", isAdvance: true },
    _sum: { amount: true },
  });
  return money(agg._sum.amount ?? 0);
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
  const applied = Prisma.Decimal.min(await advanceHeld(tx, order.id), order.total);
  return postJournalEntry(tx, {
    companyId: args.companyId,
    date: args.invoice.issueDate,
    description: `Invoice ${args.invoice.number} — ${args.partyName}`,
    sourceType: "SALE",
    sourceId: args.invoice.id,
    postedById: args.userId,
    lines: [
      { accountId: acc.RECEIVABLE, partyId: order.partyId, debit: order.total },
      { accountId: acc.SALES, credit: order.subtotal.minus(order.discount) },
      { accountId: acc.DELIVERY_INCOME, credit: order.shippingCharge },
      { accountId: acc.VAT_PAYABLE, credit: order.tax },
      {
        accountId: acc.CUSTOMER_ADVANCE,
        partyId: order.partyId,
        debit: applied,
        memo: "Advance applied",
      },
      {
        accountId: acc.RECEIVABLE,
        partyId: order.partyId,
        credit: applied,
        memo: "Advance applied",
      },
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
