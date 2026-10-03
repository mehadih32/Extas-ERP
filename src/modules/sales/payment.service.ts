import { Prisma, type ProformaInvoice } from "@prisma/client";

import { dayRange } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import { recordPartyActivity } from "@/modules/parties/party.service";
import { assertNotWalkIn } from "@/modules/parties/walk-in";
import { createProjectFromProformaTx } from "@/modules/production/project.service";
import {
  ledgerPartyId,
  refreshOrderPayments,
  refreshProformaPayments,
} from "@/modules/sales/posting";
import { listPaymentsSchema, receivePaymentSchema } from "@/modules/sales/schemas";
import { money } from "@/modules/sales/totals";

type Tx = Prisma.TransactionClient;
type ReceiveInput = ReturnType<typeof receivePaymentSchema.parse>;

/**
 * Money receipts are kept apart from selling: by default only Accounts and
 * Super Admin may record them (checked here too, so no caller can skip it).
 */
export function assertCanRecordReceipts(ctx: CompanyContext) {
  if (!ctx.can("accounts.receipts.record")) {
    throw new AppError(
      "FORBIDDEN",
      "Only Accounts can record money received. Save the order without the payment.",
    );
  }
}

/**
 * Records money received from a buyer (inside a transaction) and posts it:
 * against an order or proforma before invoicing it is an advance; after
 * invoicing, or on account, it reduces the receivable.
 */
export async function receivePaymentTx(
  tx: Tx,
  ctx: CompanyContext,
  input: ReceiveInput,
  meta?: RequestMeta,
) {
  assertCanRecordReceipts(ctx);
  const companyId = ctx.company.id;
  const amount = money(input.amount);
  let partyId: string | null = null;
  let isAdvance = false;
  let label: string;
  let proformaToCheck: { id: string } | null = null;

  if (input.orderId) {
    await lockRow(tx, "SalesOrder", input.orderId);
    const order = await tx.salesOrder.findFirst({
      where: { id: input.orderId, companyId },
      include: { invoice: { select: { status: true } } },
    });
    if (!order) throw new AppError("NOT_FOUND", "Order not found.");
    if (order.status === "CANCELLED") throw new AppError("CONFLICT", "This order is cancelled.");
    if (amount.gt(order.total.minus(order.paidAmount))) {
      throw new AppError(
        "VALIDATION",
        `Only ${order.total.minus(order.paidAmount).toFixed(2)} is due on ${order.number}.`,
      );
    }
    partyId = order.partyId;
    isAdvance = !order.invoice || order.invoice.status === "VOID";
    label = order.number;
  } else if (input.proformaId) {
    await lockRow(tx, "ProformaInvoice", input.proformaId);
    const proforma = await tx.proformaInvoice.findFirst({
      where: { id: input.proformaId, companyId },
    });
    if (!proforma) throw new AppError("NOT_FOUND", "Proforma invoice not found.");
    if (proforma.status === "CANCELLED" || proforma.status === "CONVERTED") {
      throw new AppError(
        "CONFLICT",
        `This proforma is ${proforma.status.toLowerCase()}; take payment on its order instead.`,
      );
    }
    if (amount.gt(proforma.total.minus(proforma.advancePaid))) {
      throw new AppError(
        "VALIDATION",
        `Only ${proforma.total.minus(proforma.advancePaid).toFixed(2)} is left on ${proforma.number}.`,
      );
    }
    partyId = proforma.partyId;
    isAdvance = true;
    label = proforma.number;
    proformaToCheck = proforma;
  } else {
    const party = await tx.party.findFirst({ where: { id: input.partyId, companyId } });
    if (!party) throw new AppError("NOT_FOUND", "Buyer not found.");
    if (party.kind === "SUPPLIER")
      throw new AppError("VALIDATION", `${party.name} is not a buyer.`);
    assertNotWalkIn(party, "Take a walk-in customer's payment against their order.");
    partyId = party.id;
    label = `on account (${party.code})`;
  }

  const accounts = await ensureControlAccounts(companyId, tx);
  const debitAccount = await cashAccountFor(tx, companyId, input.method, input.accountId);
  const paymentDate = input.paymentDate ?? new Date();
  const payment = await tx.payment.create({
    data: {
      companyId,
      number: await nextDocumentNumber(tx, companyId, "PAYMENT_RECEIPT"),
      direction: "RECEIVED",
      method: input.method,
      partyId,
      amount,
      paymentDate,
      accountId: debitAccount,
      orderId: input.orderId ?? null,
      proformaId: input.proformaId ?? null,
      reference: input.reference ?? null,
      isAdvance,
      notes: input.notes ?? null,
    },
  });
  const entry = await postJournalEntry(tx, {
    companyId,
    date: paymentDate,
    description: `Payment ${payment.number} received — ${label}`,
    sourceType: "PAYMENT",
    sourceId: payment.id,
    postedById: ctx.user.id,
    lines: [
      { accountId: debitAccount, debit: amount, memo: input.reference ?? undefined },
      {
        accountId: isAdvance ? accounts.CUSTOMER_ADVANCE : accounts.RECEIVABLE,
        partyId: await ledgerPartyId(tx, companyId, partyId),
        credit: amount,
        memo: isAdvance ? "Advance" : undefined,
      },
    ],
  });
  await tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });

  if (input.orderId) await refreshOrderPayments(tx, input.orderId);

  let productionProject: { id: string; code: string } | null = null;
  if (proformaToCheck) {
    const updated = await refreshProformaPayments(tx, proformaToCheck.id);
    productionProject = await startProductionIfAdvancePaid(tx, ctx, updated, paymentDate, meta);
  }
  if (partyId) await recordPartyActivity(partyId, paymentDate, tx);
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "Payment",
      entityId: payment.id,
      summary: `Received ${amount.toFixed(2)} (${input.method}) ${payment.number} — ${label}`,
    },
    tx,
  );
  return { payment: { ...payment, journalEntryId: entry.id }, productionProject };
}

/**
 * An issued proforma whose advance is now paid in full goes into production: a
 * production project is created for it. Returns the project, or null when
 * nothing starts.
 */
export async function startProductionIfAdvancePaid(
  tx: Tx,
  ctx: CompanyContext,
  proforma: ProformaInvoice,
  paidAt: Date,
  meta?: RequestMeta,
) {
  if (proforma.status !== "ISSUED" || proforma.advancePaid.lt(proforma.advanceAmount)) return null;
  await tx.proformaInvoice.update({
    where: { id: proforma.id },
    data: { status: "ADVANCE_RECEIVED", advancePaidAt: paidAt },
  });
  await tx.proformaInvoice.update({
    where: { id: proforma.id },
    data: { status: "IN_PRODUCTION" },
  });
  return createProjectFromProformaTx(tx, ctx, proforma, meta);
}

export async function receivePayment(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = receivePaymentSchema.parse(raw);
  return prisma.$transaction((tx) => receivePaymentTx(tx, ctx, input, meta), { timeout: 30_000 });
}

export async function listPayments(ctx: CompanyContext, raw: unknown = {}) {
  const q = listPaymentsSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.payment.findMany({
    where: {
      direction: "RECEIVED",
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(start || end
        ? { paymentDate: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    include: {
      party: { select: { id: true, code: true, name: true } },
      account: { select: { id: true, code: true, name: true } },
      order: { select: { id: true, number: true } },
      proforma: { select: { id: true, number: true } },
    },
    orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}

/**
 * Money receipt document data: money received from a buyer (payments made to
 * suppliers are not sales data and answer "not found" here).
 *
 * `receivedToDate` is what had come in on the receipt's proforma (or order) up
 * to and including this payment, by payment date, less what was refunded from
 * it before then (`refundedToDate`, refunds that are not void), so a receipt
 * printed again later still shows the position it was written for. Both are
 * null for a payment on account.
 */
export async function getPaymentReceipt(ctx: CompanyContext, paymentId: string) {
  const payment = await ctx.db.payment.findUnique({
    where: { id: paymentId, direction: "RECEIVED" },
    include: {
      party: {
        select: {
          id: true,
          code: true,
          name: true,
          contactPerson: true,
          phone: true,
          address: true,
          taxId: true,
        },
      },
      account: { select: { name: true } },
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          paidAmount: true,
          dueAmount: true,
          customerName: true,
          customerPhone: true,
          shippingAddress: true,
          invoice: { select: { id: true, number: true, status: true } },
        },
      },
      proforma: {
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          advancePercent: true,
          advanceAmount: true,
          advancePaid: true,
        },
      },
    },
  });
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");
  // A proforma's advances move onto its order when it converts; the receipt stays with the proforma.
  const against = payment.proformaId
    ? { proformaId: payment.proformaId }
    : payment.orderId
      ? { orderId: payment.orderId }
      : null;
  let receivedToDate: Prisma.Decimal | null = null;
  let refundedToDate: Prisma.Decimal | null = null;
  if (against) {
    const { paymentDate: date, createdAt } = payment;
    const agg = await ctx.db.payment.aggregate({
      where: {
        ...against,
        direction: "RECEIVED",
        OR: [
          { paymentDate: { lt: date } },
          { paymentDate: date, createdAt: { lt: createdAt } },
          { paymentDate: date, createdAt, id: { lte: payment.id } },
        ],
      },
      _sum: { amount: true },
    });
    const refunded = await ctx.db.refund.aggregate({
      where: {
        ...against,
        voidedAt: null,
        OR: [{ refundDate: { lt: date } }, { refundDate: date, createdAt: { lt: createdAt } }],
      },
      _sum: { amount: true },
    });
    refundedToDate = money(refunded._sum.amount ?? 0);
    receivedToDate = money(agg._sum.amount ?? 0).minus(refundedToDate);
  }
  return { ...payment, receivedToDate, refundedToDate, letterhead: await letterhead(ctx) };
}
