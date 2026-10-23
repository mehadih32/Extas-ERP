import { type InvoiceStatus, Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRows } from "@/lib/row-lock";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { isWalkIn } from "@/modules/parties/walk-in";
import { assertCanRecordReceipts } from "@/modules/sales/payment.service";
import { refreshOrderPayments } from "@/modules/sales/posting";
import { applyCreditSchema } from "@/modules/sales/schemas";
import { money, ZERO } from "@/modules/sales/totals";

/*
 * A buyer's credit (their advance balance): money on their account that pays
 * no invoice yet. It comes from payments on account, the extra of a payment
 * above what was due, and refunds kept as credit. Putting it against an
 * invoiced order (a CreditAllocation) counts as paid on that order. It posts
 * nothing: the money and the invoice already sit on the buyer's Receivable,
 * so their balance is the same either way; only the invoices' paid and due
 * figures move. Voiding an invoice releases its allocations, and the money is
 * credit again.
 *
 *   balance      Receivable debits less credits (what they owe overall; below
 *                zero, the company owes them)
 *   open dues    what their live invoices still show as due
 *   credit       open dues less balance: money on the account no invoice uses
 *   previous due the balance when above zero: what they owed before a new bill
 *
 * Credit is used one buyer at a time (lockBuyerCredit), always before any of
 * their orders is locked, so two people cannot spend the same credit twice.
 */

type Tx = Prisma.TransactionClient;

/** Invoices that can still take money. */
const OPEN_STATUSES: InvoiceStatus[] = ["UNPAID", "PARTIALLY_PAID"];

/**
 * Holds the buyer's credit until the transaction ends. Taken before any order
 * lock by every step that uses credit, so they queue instead of deadlocking.
 */
export async function lockBuyerCredit(tx: Tx, partyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`buyer-credit:${partyId}`}))`;
}

/** A buyer's balance, open dues, unused credit and previous due (see above). */
export async function creditPosition(db: Db, companyId: string, partyId: string) {
  const acc = await ensureControlAccounts(companyId, db);
  const [ledger, dues] = await Promise.all([
    db.journalLine.aggregate({
      where: { accountId: acc.RECEIVABLE, partyId },
      _sum: { debit: true, credit: true },
    }),
    db.invoice.aggregate({
      where: { companyId, partyId, status: { in: OPEN_STATUSES } },
      _sum: { dueAmount: true },
    }),
  ]);
  const balance = money(ledger._sum.debit ?? 0).minus(money(ledger._sum.credit ?? 0));
  const openDues = money(dues._sum?.dueAmount ?? 0);
  return {
    balance,
    openDues,
    credit: Prisma.Decimal.max(openDues.minus(balance), ZERO),
    previousDue: Prisma.Decimal.max(balance, ZERO),
  };
}

/** A buyer's invoices with money still due, oldest first (the order credit pays them in). */
export async function openDuesOf(db: Db, companyId: string, partyId: string, except?: string) {
  return db.invoice.findMany({
    where: {
      companyId,
      partyId,
      status: { in: OPEN_STATUSES },
      dueAmount: { gt: 0 },
      ...(except ? { orderId: { not: except } } : {}),
    },
    select: {
      id: true,
      number: true,
      orderId: true,
      issueDate: true,
      dueDate: true,
      total: true,
      dueAmount: true,
      order: { select: { number: true } },
    },
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
}

export type AllocationRequest = { orderId: string; amount: Prisma.Decimal.Value };

/**
 * Puts the buyer's money against their invoiced orders (inside a transaction,
 * after lockBuyerCredit). Each order must be theirs, have a live invoice and
 * still owe the amount; together they may take at most `limit` (the payment
 * just received, or the credit on the account). Returns what was allocated.
 * `salesReturnId` puts a website return's credit against its own invoice
 * (return.service.ts): that order has no buyer, and `partyId` is then the
 * Walk-in customers account its credit sits on.
 */
export async function allocateTx(
  tx: Tx,
  ctx: CompanyContext,
  args: {
    partyId: string;
    paymentId?: string | null;
    salesReturnId?: string | null;
    items: AllocationRequest[];
    limit: Prisma.Decimal;
  },
) {
  const items = args.items
    .map((i) => ({ orderId: i.orderId, amount: money(i.amount) }))
    .filter((i) => i.amount.gt(0));
  if (items.length === 0) return [];
  const ids = items.map((i) => i.orderId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError("VALIDATION", "An invoice is listed twice.");
  }
  const total = items.reduce((s, i) => s.plus(i.amount), ZERO);
  if (total.gt(args.limit)) {
    throw new AppError(
      "VALIDATION",
      `Only ${args.limit.toFixed(2)} can be put against invoices here.`,
      { allocations: [`At most ${args.limit.toFixed(2)} in all`] },
    );
  }
  await lockRows(tx, "SalesOrder", ids);
  const orders = await tx.salesOrder.findMany({
    where: { id: { in: ids }, companyId: ctx.company.id },
    select: {
      id: true,
      number: true,
      partyId: true,
      status: true,
      total: true,
      paidAmount: true,
      invoice: { select: { id: true, number: true, status: true } },
    },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const errors: Record<string, string[]> = {};
  for (const item of items) {
    const order = byId.get(item.orderId);
    const key = `allocations.${item.orderId}`;
    // A website return's order has no buyer: its credit is on the Walk-in customers account.
    const owner = order?.partyId ?? (args.salesReturnId ? args.partyId : null);
    if (!order || owner !== args.partyId) {
      errors[key] = ["Not an order of this buyer"];
      continue;
    }
    const invoice = order.invoice && order.invoice.status !== "VOID" ? order.invoice : null;
    if (order.status === "CANCELLED" || !invoice) {
      errors[key] = [`${order.number} has no invoice to pay`];
      continue;
    }
    const due = Prisma.Decimal.max(order.total.minus(order.paidAmount), ZERO);
    if (item.amount.gt(due)) errors[key] = [`At most ${due.toFixed(2)} is due`];
  }
  if (Object.keys(errors).length > 0) {
    const first = Object.values(errors)[0]![0]!;
    throw new AppError("VALIDATION", first, errors);
  }
  const lines = items.map((item) => {
    const order = byId.get(item.orderId)!;
    return { ...item, number: order.number, invoiceId: order.invoice!.id };
  });
  await tx.creditAllocation.createMany({
    data: lines.map((line) => ({
      companyId: ctx.company.id,
      partyId: args.partyId,
      orderId: line.orderId,
      invoiceId: line.invoiceId,
      paymentId: args.paymentId ?? null,
      salesReturnId: args.salesReturnId ?? null,
      amount: line.amount,
      createdById: ctx.user.id,
    })),
  });
  for (const line of lines) await refreshOrderPayments(tx, line.orderId);
  return lines.map((l) => ({ orderId: l.orderId, number: l.number, amount: l.amount }));
}

/** "Use credit": puts the buyer's credit against one invoiced order (inside a transaction). */
export async function applyCreditTx(
  tx: Tx,
  ctx: CompanyContext,
  input: { orderId: string; amount: Prisma.Decimal.Value },
  meta?: RequestMeta,
) {
  assertCanRecordReceipts(ctx);
  const companyId = ctx.company.id;
  const amount = money(input.amount);
  const peek = await tx.salesOrder.findFirst({
    where: { id: input.orderId, companyId },
    select: { partyId: true, party: { select: { name: true, code: true } } },
  });
  if (!peek) throw new AppError("NOT_FOUND", "Order not found.");
  if (!peek.partyId || !peek.party) {
    throw new AppError("VALIDATION", "A walk-in customer has no account to hold credit.");
  }
  await lockBuyerCredit(tx, peek.partyId);
  const { credit } = await creditPosition(tx, companyId, peek.partyId);
  if (amount.gt(credit)) {
    throw new AppError(
      "VALIDATION",
      credit.isZero()
        ? `${peek.party.name} has no credit to use.`
        : `${peek.party.name} has only ${credit.toFixed(2)} of credit.`,
      { amount: [`At most ${credit.toFixed(2)}`] },
    );
  }
  const [line] = await allocateTx(tx, ctx, {
    partyId: peek.partyId,
    items: [{ orderId: input.orderId, amount }],
    limit: credit,
  });
  if (!line) throw new AppError("VALIDATION", "Enter the amount of credit to use.");
  await auditInCompany(
    ctx,
    meta,
    {
      action: "UPDATE",
      entityType: "SalesOrder",
      entityId: input.orderId,
      summary: `Used ${amount.toFixed(2)} of ${peek.party.name}'s credit (${peek.party.code}) on ${line.number}`,
    },
    tx,
  );
  return { orderId: input.orderId, number: line.number, amount, creditLeft: credit.minus(amount) };
}

export async function applyCredit(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = applyCreditSchema.parse(raw);
  return prisma.$transaction((tx) => applyCreditTx(tx, ctx, { orderId, ...input }, meta), {
    timeout: 30_000,
  });
}

/**
 * Gives the credit put against an order back to the buyer's account (its
 * invoice was voided). The rows stay, marked released, for the record.
 */
export async function releaseAllocationsTx(tx: Tx, orderId: string, reason: string) {
  const agg = await tx.creditAllocation.aggregate({
    where: { orderId, releasedAt: null },
    _sum: { amount: true },
  });
  const released = money(agg._sum.amount ?? 0);
  if (released.gt(0)) {
    await tx.creditAllocation.updateMany({
      where: { orderId, releasedAt: null },
      data: { releasedAt: new Date(), releaseReason: reason.slice(0, 500) },
    });
  }
  return released;
}

/**
 * A website order's return credit put against its own invoice (sales returns
 * on a sale without a buyer, return.service.ts): money that paid the due in
 * place of the customer, so a payment that comes in later (the courier's
 * remittance of a COD collected before the return, a prepaid bKash synced
 * late) may take that place back.
 */
export async function returnCreditOnOrder(db: Db, orderId: string) {
  const agg = await db.creditAllocation.aggregate({
    where: { orderId, salesReturnId: { not: null }, releasedAt: null },
    _sum: { amount: true },
  });
  return money(agg._sum.amount ?? 0);
}

/**
 * Gives `amount` of a website order's return credit back to its returns (the
 * order is locked; the returns are locked here, after it), newest first: each
 * allocation it touches is released and, when only part of it goes, a smaller
 * one takes its place. That much of the credit is then left to pay back to
 * the customer from the credit note. Inside the payment's transaction.
 */
export async function releaseReturnCreditTx(
  tx: Tx,
  ctx: CompanyContext,
  orderId: string,
  amount: Prisma.Decimal,
  reason: string,
) {
  const rows = await tx.creditAllocation.findMany({
    where: { orderId, salesReturnId: { not: null }, releasedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  await lockRows(
    tx,
    "SalesReturn",
    rows.map((r) => r.salesReturnId!),
  );
  let left = money(amount);
  const now = new Date();
  for (const row of rows) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(left, row.amount);
    await tx.creditAllocation.update({
      where: { id: row.id },
      data: { releasedAt: now, releaseReason: reason.slice(0, 500) },
    });
    const keep = row.amount.minus(take);
    if (keep.gt(0)) {
      await tx.creditAllocation.create({
        data: {
          companyId: row.companyId,
          partyId: row.partyId,
          orderId: row.orderId,
          invoiceId: row.invoiceId,
          paymentId: row.paymentId,
          salesReturnId: row.salesReturnId,
          amount: keep,
          createdById: ctx.user.id,
        },
      });
    }
    left = left.minus(take);
  }
  if (left.gt(0)) {
    throw new AppError("CONFLICT", "The order's return credit changed meanwhile. Try again.");
  }
}

/** What a buyer can use at checkout and on a bill: previous due and credit, as text. */
export async function getBuyerMoney(ctx: CompanyContext, partyId: string) {
  const party = await ctx.db.party.findUnique({
    where: { id: partyId },
    select: { id: true, name: true, kind: true, systemRole: true },
  });
  if (!party || party.kind === "SUPPLIER" || isWalkIn(party)) {
    throw new AppError("NOT_FOUND", "Buyer not found.");
  }
  const position = await creditPosition(prisma, ctx.company.id, party.id);
  return {
    partyId: party.id,
    previousDue: position.previousDue.toFixed(2),
    credit: position.credit.toFixed(2),
    openDues: position.openDues.toFixed(2),
  };
}

/** A buyer's unpaid invoices for the payment window's grid, oldest first. */
export async function getBuyerOpenDues(ctx: CompanyContext, partyId: string) {
  const position = await getBuyerMoney(ctx, partyId);
  const dues = await openDuesOf(prisma, ctx.company.id, partyId);
  const tz = ctx.company.timezone;
  return {
    ...position,
    dues: dues.map((d) => ({
      orderId: d.orderId,
      orderNumber: d.order.number,
      invoiceId: d.id,
      invoiceNumber: d.number,
      issuedOn: localDay(d.issueDate, tz),
      dueDate: d.dueDate ? localDay(d.dueDate, tz) : null,
      total: d.total.toFixed(2),
      due: d.dueAmount.toFixed(2),
    })),
  };
}
