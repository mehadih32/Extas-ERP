import type { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import {
  assertCanRecordReturns,
  getSalesReturn,
  listSalesReturns,
  qcOf,
  restockShortfall,
  restockShortfallMessage,
  returnCredit,
  returnPosition,
  walkInReturnCredit,
} from "@/modules/sales/return.service";
import { canReturnOnInvoice, canVoidSalesReturn, settleKinds } from "@/modules/sales/rules";
import { presentRefunds, salesAccess } from "@/modules/sales/screens.service";
import { money } from "@/modules/sales/totals";

/*
 * What the sales return (credit note) screens show, as plain values like the
 * other Sales screens. Anyone with sales.view sees returns; recording and
 * voiding one is Accounts' (accounts.receipts.record), as the service checks.
 * What the pieces cost shows only to people who see the financials.
 */

const fixed = (value: Prisma.Decimal) => value.toFixed(2);

type ListedReturn = Awaited<ReturnType<typeof listSalesReturns>>["items"][number];

function presentReturnRow(r: ListedReturn, tz: string) {
  return {
    id: r.id,
    number: r.number,
    returnedOn: localDay(r.receivedAt, tz),
    amount: fixed(r.amount),
    pieces: r.items.reduce((s, i) => s + i.quantity, 0),
    reason: r.reason,
    voided: r.voidedAt !== null,
    buyer: r.party,
    /** A sale without a buyer (a website order): the customer named on the order. */
    customerName: r.party ? null : r.order.customerName,
    invoice: r.invoice!,
    order: { id: r.order.id, number: r.order.number },
  };
}

export type SalesReturnRow = ReturnType<typeof presentReturnRow>;

export async function listSalesReturnRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listSalesReturns(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((r) => presentReturnRow(r, tz)), nextCursor: page.nextCursor };
}

/** The Returns tab, and whether this person may record one. */
export async function getSalesReturnList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listSalesReturnRows(ctx, raw)), canRecord: salesAccess(ctx).receive };
}

export type SalesReturnList = Awaited<ReturnType<typeof getSalesReturnList>>;

/** One credit note: what came back at what price, where it went, and the buyer's credit now. */
export async function getSalesReturnScreen(ctx: CompanyContext, returnId: string) {
  const r = await getSalesReturn(ctx, returnId);
  const tz = ctx.company.timezone;
  const access = salesAccess(ctx);
  const invoice = r.invoice!;
  const live = r.voidedAt === null;
  // Voiding takes the credit back, so the buyer must not have spent it.
  const credit =
    r.partyId && (access.receive || access.openBuyer)
      ? await returnCredit(prisma, ctx.company.id, { ...r, partyId: r.partyId })
      : null;
  const position = credit?.position ?? null;
  // A website return (no buyer): what its credit paid on its invoice, was paid back, is left.
  const walkIn =
    !r.partyId && (access.receive || access.openBuyer) ? await walkInReturnCredit(prisma, r) : null;
  const paidBack = live && walkIn !== null && walkIn.paidBack.gt(0);
  // The refunds that paid it back, each with its voucher and (Accounts) its void.
  const refunds =
    walkIn !== null
      ? await ctx.db.refund.findMany({
          where: { salesReturnId: r.id },
          select: {
            id: true,
            number: true,
            kind: true,
            amount: true,
            method: true,
            refundDate: true,
            reason: true,
            voidedAt: true,
          },
          orderBy: [{ refundDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        })
      : [];
  const creditUsed = (live && credit !== null && credit.spent) || paidBack;
  const voidable = access.receive && canVoidSalesReturn(r).ok;
  // Pieces it put back into stock must still be there to be taken out again.
  const short =
    voidable && !creditUsed
      ? await restockShortfall(
          prisma,
          r.items.map((i) => i.id),
        )
      : [];
  const writtenOff = r.items.reduce(
    (sum, i) => sum.plus(i.badStockEntry?.lossValue ?? 0),
    money(0),
  );
  const wentTo = { stock: 0, bGrade: 0, rejects: 0 };
  for (const i of r.items) {
    const qc = qcOf(i.qcStatus);
    if (qc === "GOOD") wentTo.stock += i.quantity;
    else if (qc === "B_GRADE") wentTo.bGrade += i.quantity;
    else wentTo.rejects += i.quantity;
  }
  return {
    salesReturn: {
      id: r.id,
      number: r.number,
      returnedOn: localDay(r.receivedAt, tz),
      reason: r.reason,
      notes: r.notes,
      voided: r.voidedAt ? { on: localDay(r.voidedAt, tz), reason: r.voidReason } : null,
      buyer: r.party,
      /** A sale without a buyer (a website order): the customer named on the order. */
      customerName: r.party ? null : r.order.customerName,
      invoice: {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        issuedOn: localDay(invoice.issueDate, tz),
        total: fixed(invoice.total),
        due: fixed(invoice.dueAmount),
      },
      order: r.order,
      warehouse: r.warehouse?.name ?? null,
      recordedBy: r.createdBy?.name ?? null,
      lines: r.items.map((i) => ({
        key: i.id,
        sku: i.variant.sku,
        style: i.variant.style.name,
        color: i.variant.color.name,
        size: i.variant.size.name,
        quantity: i.quantity,
        unitPrice: fixed(i.unitPrice),
        amount: fixed(i.amount),
        /** What its check found: GOOD back in stock, B_GRADE to B-grade stock, DAMAGED to the rejects. */
        qc: qcOf(i.qcStatus),
      })),
      pieces: r.items.reduce((s, i) => s + i.quantity, 0),
      /** Pieces back in sellable stock, in B-grade stock and in Damage & QC Rejects. */
      wentTo,
      goods: fixed(r.goodsValue),
      discount: fixed(r.discount),
      tax: fixed(r.tax),
      total: fixed(r.amount),
      /** What the pieces cost: only for people who see costs. */
      cost: access.seeCosts && r.costValue !== null ? fixed(r.costValue) : null,
      /** What the pieces moved to Damage & QC Rejects cost (written off). */
      writtenOff: access.seeCosts && r.costValue !== null ? fixed(writtenOff) : null,
      /** What the pieces put back into stock (A or B grade) cost. */
      restockedCost:
        access.seeCosts && r.costValue !== null ? fixed(r.costValue.minus(writtenOff)) : null,
    },
    /** The buyer's unused credit now (null: not for this person). */
    buyerCredit: position ? fixed(position.credit) : null,
    /**
     * What the buyer owes outside their open invoices (an opening balance,
     * say), which credit pays first; null when nothing or not for this person.
     */
    earlierBalance:
      position && position.balance.gt(position.openDues)
        ? fixed(position.balance.minus(position.openDues))
        : null,
    /** A website return's credit: used on its own invoice, paid back, and left to pay back. */
    walkInCredit: walkIn
      ? {
          usedOnInvoice: fixed(walkIn.usedOnInvoice),
          paidBack: fixed(walkIn.paidBack),
          left: fixed(walkIn.left),
        }
      : null,
    /** Refunds of a website return's credit (void ones too), as the order page lists refunds. */
    paidBack: presentRefunds(ctx, refunds, {}),
    can: {
      void: voidable && !creditUsed && short.length === 0,
      openBuyer: access.openBuyer && r.party !== null,
      /** Use the credit on the invoice's own order ("Use credit" on the order). */
      useCredit:
        access.receive &&
        live &&
        invoice.status !== "VOID" &&
        invoice.dueAmount.gt(0) &&
        position !== null &&
        position.credit.gt(0),
      /** How a website return's credit left over may be paid back ("Pay back the credit"). */
      payBackKinds:
        live && walkIn !== null && walkIn.left.gt(0) ? settleKinds(ctx, { onAccount: false }) : [],
    },
    notes: {
      /** Why voiding, which this person could otherwise do, is not offered. */
      void:
        voidable && paidBack
          ? `${fixed(walkIn!.paidBack)} of this credit was paid back. Void that refund first to void the return.`
          : voidable && creditUsed
            ? `The buyer has used this credit (${fixed(position!.credit)} of ${fixed(r.amount)} is unused), so it can no longer be voided.`
            : short.length > 0
              ? restockShortfallMessage(r.number, short)
              : null,
      /** Why less credit is unused than the return gave, though none was spent. */
      credit:
        live && credit !== null && !credit.spent && credit.position.credit.lt(r.amount)
          ? "Credit first pays what the buyer owed from before outside their invoices, such as an opening balance. Only what is left of it can be used on invoices."
          : null,
    },
  };
}

export type SalesReturnScreen = Awaited<ReturnType<typeof getSalesReturnScreen>>;

/**
 * What the "Sales return" form needs for an invoice: each line with the pieces
 * delivered and not back yet, the price billed and what is left of the line,
 * and the invoice's discount and VAT for the estimate. `blocked` says why no
 * return can be made on it.
 */
export async function getSalesReturnForm(ctx: CompanyContext, invoiceId: string) {
  assertCanRecordReturns(ctx);
  const tz = ctx.company.timezone;
  const invoice = await ctx.db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      number: true,
      status: true,
      partyId: true,
      issueDate: true,
      total: true,
      dueAmount: true,
      party: { select: { id: true, code: true, name: true } },
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          subtotal: true,
          discount: true,
          tax: true,
          customerName: true,
          warehouse: { select: { name: true } },
        },
      },
    },
  });
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found.");
  const position = await returnPosition(prisma, invoice.order.id);
  const verdict = canReturnOnInvoice(invoice, invoice.order, position);
  return {
    invoice: {
      id: invoice.id,
      number: invoice.number,
      issuedOn: localDay(invoice.issueDate, tz),
      total: fixed(invoice.total),
      due: fixed(invoice.dueAmount),
    },
    order: { id: invoice.order.id, number: invoice.order.number },
    buyer: invoice.party,
    customerName: invoice.order.customerName,
    warehouse: invoice.order.warehouse?.name ?? null,
    today: localDay(new Date(), tz),
    lines: position.lines.map((l) => ({
      id: l.id,
      sku: l.variant.sku,
      style: l.variant.style.name,
      color: l.variant.color.name,
      size: l.variant.size.name,
      billed: l.quantity,
      delivered: l.delivered,
      returned: l.returned,
      /** Delivered pieces not back yet: at most this many can come back now. */
      returnable: l.returnable,
      priceBilled: fixed(l.priceBilled),
      /** Pieces of the line not on a return yet, and their value (for the estimate). */
      left: l.quantity - l.returned,
      leftValue: fixed(money(l.lineTotal).minus(money(l.returnedAmount))),
    })),
    /** The invoice's discount and VAT, with what earlier returns took back, for the estimate. */
    shares: {
      subtotal: fixed(invoice.order.subtotal),
      discount: fixed(invoice.order.discount),
      tax: fixed(invoice.order.tax),
      earlierDiscount: fixed(position.earlier.discount),
      earlierTax: fixed(position.earlier.tax),
      ordered: position.ordered,
      returned: position.returned,
    },
    blocked: verdict.ok ? null : verdict.message,
  };
}

export type SalesReturnForm = Awaited<ReturnType<typeof getSalesReturnForm>>;

/**
 * Invoices a return can be recorded on (named buyer, not void, goods
 * delivered), newest first, for the "Choose the invoice" step.
 */
export async function findReturnableInvoices(ctx: CompanyContext, search: string) {
  assertCanRecordReturns(ctx);
  const q = search.trim().slice(0, 100);
  const tz = ctx.company.timezone;
  const rows = await ctx.db.invoice.findMany({
    where: {
      status: { not: "VOID" },
      partyId: { not: null },
      order: { status: { in: ["PROCESSING", "DELIVERED", "PARTIALLY_RETURNED"] } },
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { order: { number: { contains: q, mode: "insensitive" } } },
              { party: { name: { contains: q, mode: "insensitive" } } },
              { party: { code: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      number: true,
      issueDate: true,
      total: true,
      party: { select: { name: true, code: true } },
      order: { select: { number: true, status: true } },
    },
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take: 20,
  });
  return rows.map((i) => ({
    id: i.id,
    number: i.number,
    issuedOn: localDay(i.issueDate, tz),
    total: fixed(i.total),
    buyer: i.party!,
    order: i.order,
  }));
}

export type ReturnableInvoice = Awaited<ReturnType<typeof findReturnableInvoices>>[number];
