import { type PaymentMethod, Prisma, type RefundKind } from "@prisma/client";

import { dayRange } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import { assertNotWalkIn } from "@/modules/parties/walk-in";
import { startProductionIfAdvancePaid } from "@/modules/sales/payment.service";
import {
  heldOnOrder,
  heldOnProforma,
  ledgerPartyId,
  refreshOrderPayments,
  refreshProformaPayments,
} from "@/modules/sales/posting";
import {
  canRefundAs,
  canRefundOrder,
  canRefundProforma,
  canVoidRefund,
} from "@/modules/sales/rules";
import { listRefundsSchema, refundSchema, voidRefundSchema } from "@/modules/sales/schemas";
import { money, ZERO } from "@/modules/sales/totals";

/*
 * Buyer refunds: money taken back off what a buyer paid, by Accounts.
 *
 * On an order or a proforma the money is held as an advance (an invoiced
 * order's invoice is voided first, which turns its payments back into one):
 *   CASH     paid back            Dr Customer Advance (buyer)  Cr Cash / Bank / Wallet
 *   CREDIT   kept on account      Dr Customer Advance (buyer)  Cr Receivable (buyer)
 *   FORFEIT  cancellation charge  Dr Customer Advance (buyer)  Cr Other Income
 * On the buyer's account, its credit (payments on account, CREDIT refunds):
 *   CASH                          Dr Receivable (buyer)        Cr Cash / Bank / Wallet
 *   FORFEIT                       Dr Receivable (buyer)        Cr Other Income
 *
 * What an order or proforma holds (its paid amount) is what was received on it
 * less its refunds that are not void; cancelling one that still holds money
 * settles all of it as one refund. Voiding a refund reverses its entry and puts
 * the money back where it came from.
 */

type Tx = Prisma.TransactionClient;

/** A refund to record; `amount` is checked against what is held. */
export type RefundRequest = {
  kind: RefundKind;
  orderId?: string;
  proformaId?: string;
  partyId?: string;
  amount: Prisma.Decimal.Value;
  reason: string;
  method?: PaymentMethod;
  accountId?: string;
  refundDate?: Date;
  reference?: string | null;
  notes?: string | null;
};

export const REFUND_KIND_TEXT: Record<RefundKind, string> = {
  CASH: "paid back",
  CREDIT: "kept as credit on account",
  FORFEIT: "kept as a cancellation charge",
};

/**
 * Refunds are Accounts' work, like every money record (checked here too, so no
 * caller can skip it): paying money back needs accounts.payments.record, moving
 * it onto the buyer's account accounts.receipts.record, and keeping it as
 * income accounts.manage.
 */
export function assertCanRefund(ctx: CompanyContext, kind: RefundKind) {
  assertAllowed(canRefundAs(ctx, kind));
}

/** A buyer's credit on account: what their receivable shows the company owes them. */
export async function accountCredit(db: Db, companyId: string, partyId: string) {
  const acc = await ensureControlAccounts(companyId, db);
  const agg = await db.journalLine.aggregate({
    where: { accountId: acc.RECEIVABLE, partyId },
    _sum: { debit: true, credit: true },
  });
  return Prisma.Decimal.max(money(agg._sum.credit ?? 0).minus(money(agg._sum.debit ?? 0)), ZERO);
}

function assertWithinHeld(amount: Prisma.Decimal, held: Prisma.Decimal, number: string) {
  if (held.lte(0)) {
    throw new AppError("CONFLICT", `Nothing paid on ${number} is left to refund.`);
  }
  if (amount.gt(held)) {
    throw new AppError(
      "VALIDATION",
      `Only ${held.toFixed(2)} paid on ${number} is left to refund.`,
      {
        amount: [`At most ${held.toFixed(2)}`],
      },
    );
  }
}

/** Records a refund inside a transaction (the order or proforma is locked here). */
export async function refundBuyerTx(
  tx: Tx,
  ctx: CompanyContext,
  input: RefundRequest,
  meta?: RequestMeta,
) {
  assertCanRefund(ctx, input.kind);
  const companyId = ctx.company.id;
  const amount = money(input.amount);
  if (amount.lte(0)) throw new AppError("VALIDATION", "Enter the amount to refund.");
  let partyId: string | null;
  let label: string;
  // Money on an order or proforma is an advance; money on the buyer's account is receivable.
  let fromAdvance = true;

  if (input.orderId) {
    await lockRow(tx, "SalesOrder", input.orderId);
    const order = await tx.salesOrder.findFirst({
      where: { id: input.orderId, companyId },
      include: { invoice: { select: { number: true, status: true } } },
    });
    if (!order) throw new AppError("NOT_FOUND", "Order not found.");
    const held = await heldOnOrder(tx, order.id);
    assertAllowed(canRefundOrder(order, held));
    assertWithinHeld(amount, held, order.number);
    partyId = order.partyId;
    label = `order ${order.number}`;
  } else if (input.proformaId) {
    await lockRow(tx, "ProformaInvoice", input.proformaId);
    const proforma = await tx.proformaInvoice.findFirst({
      where: { id: input.proformaId, companyId },
    });
    if (!proforma) throw new AppError("NOT_FOUND", "Proforma invoice not found.");
    const held = await heldOnProforma(tx, proforma.id);
    assertAllowed(canRefundProforma(proforma, held));
    assertWithinHeld(amount, held, proforma.number);
    partyId = proforma.partyId;
    label = `proforma ${proforma.number}`;
  } else {
    if (input.kind === "CREDIT") {
      throw new AppError("VALIDATION", "This money is already credit on the buyer's account.");
    }
    const party = await tx.party.findFirst({ where: { id: input.partyId, companyId } });
    if (!party) throw new AppError("NOT_FOUND", "Buyer not found.");
    if (party.kind === "SUPPLIER") {
      throw new AppError("VALIDATION", `${party.name} is not a buyer.`);
    }
    assertNotWalkIn(party, "A walk-in customer's money is refunded on their order.");
    await lockRow(tx, "Party", party.id);
    const credit = await accountCredit(tx, companyId, party.id);
    if (amount.gt(credit)) {
      throw new AppError(
        "VALIDATION",
        credit.isZero()
          ? `${party.name} has no credit on account to refund.`
          : `${party.name} has only ${credit.toFixed(2)} of credit on account.`,
        { amount: [`At most ${credit.toFixed(2)}`] },
      );
    }
    partyId = party.id;
    label = `${party.name}'s account (${party.code})`;
    fromAdvance = false;
  }
  if (input.kind === "CREDIT" && !partyId) {
    throw new AppError(
      "VALIDATION",
      "A walk-in customer has no account to keep credit on. Pay the money back or keep it as a cancellation charge.",
    );
  }

  const acc = await ensureControlAccounts(companyId, tx);
  // A walk-in customer's money sits on the Walk-in customers account.
  const ledgerParty = await ledgerPartyId(tx, companyId, partyId);
  const cashAccount =
    input.kind === "CASH"
      ? await cashAccountFor(tx, companyId, input.method ?? "CASH", input.accountId)
      : null;
  const refundDate = input.refundDate ?? new Date();
  const refund = await tx.refund.create({
    data: {
      companyId,
      number: await nextDocumentNumber(tx, companyId, "REFUND_VOUCHER"),
      kind: input.kind,
      partyId,
      orderId: input.orderId ?? null,
      proformaId: input.proformaId ?? null,
      amount,
      refundDate,
      method: input.kind === "CASH" ? (input.method ?? "CASH") : null,
      accountId: cashAccount,
      reference: input.reference ?? null,
      reason: input.reason,
      notes: input.notes ?? null,
      createdById: ctx.user.id,
    },
  });
  const entry = await postJournalEntry(tx, {
    companyId,
    date: refundDate,
    description: `Refund ${refund.number}: ${amount.toFixed(2)} ${REFUND_KIND_TEXT[input.kind]} from ${label} — ${input.reason}`,
    sourceType: "REFUND",
    sourceId: refund.id,
    postedById: ctx.user.id,
    lines: [
      {
        accountId: fromAdvance ? acc.CUSTOMER_ADVANCE : acc.RECEIVABLE,
        partyId: ledgerParty,
        debit: amount,
        memo: fromAdvance ? "Advance refunded" : "Credit on account refunded",
      },
      input.kind === "CASH"
        ? { accountId: cashAccount!, credit: amount, memo: input.reference ?? undefined }
        : input.kind === "CREDIT"
          ? {
              accountId: acc.RECEIVABLE,
              partyId: ledgerParty,
              credit: amount,
              memo: "Credit on account",
            }
          : { accountId: acc.OTHER_INCOME, credit: amount, memo: "Cancellation charge" },
    ],
  });
  await tx.refund.update({ where: { id: refund.id }, data: { journalEntryId: entry.id } });
  if (input.orderId) await refreshOrderPayments(tx, input.orderId);
  if (input.proformaId) await refreshProformaPayments(tx, input.proformaId);
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "Refund",
      entityId: refund.id,
      summary: `Refund ${refund.number}: ${amount.toFixed(2)} ${REFUND_KIND_TEXT[input.kind]} from ${label} — ${input.reason}`,
    },
    tx,
  );
  return { ...refund, journalEntryId: entry.id };
}

/** Takes money back off an order, a proforma or a buyer's account (Accounts). */
export async function refundBuyer(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = refundSchema.parse(raw);
  assertCanRefund(ctx, input.kind);
  const refund = await prisma.$transaction((tx) => refundBuyerTx(tx, ctx, input, meta), {
    timeout: 30_000,
  });
  return getRefund(ctx, refund.id);
}

/**
 * Voids a refund recorded by mistake: its entry is reversed and the money is held
 * again where it came from. Not once that order or proforma is cancelled (or the
 * order invoiced again), nor for credit the buyer has used since.
 */
export async function voidRefund(
  ctx: CompanyContext,
  refundId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = voidRefundSchema.parse(raw);
  const found = await ctx.db.refund.findUnique({ where: { id: refundId } });
  if (!found) throw new AppError("NOT_FOUND", "Refund not found.");
  assertCanRefund(ctx, found.kind);
  const companyId = ctx.company.id;
  await prisma.$transaction(
    async (tx) => {
      // Locks in the same order as refunding: the order or proforma, the buyer, the refund.
      if (found.orderId) await lockRow(tx, "SalesOrder", found.orderId);
      else if (found.proformaId) await lockRow(tx, "ProformaInvoice", found.proformaId);
      if (found.partyId) await lockRow(tx, "Party", found.partyId);
      await lockRow(tx, "Refund", found.id);
      const refund = await tx.refund.findFirstOrThrow({ where: { id: found.id, companyId } });
      const order = refund.orderId
        ? await tx.salesOrder.findUniqueOrThrow({
            where: { id: refund.orderId },
            include: { invoice: { select: { number: true, status: true } } },
          })
        : null;
      const proforma =
        !order && refund.proformaId
          ? await tx.proformaInvoice.findUniqueOrThrow({ where: { id: refund.proformaId } })
          : null;
      assertAllowed(canVoidRefund(refund, { order, proforma }));

      if (order) {
        const held = await heldOnOrder(tx, order.id);
        if (held.plus(refund.amount).gt(order.total)) {
          throw new AppError(
            "CONFLICT",
            `${order.number} has been paid again since; voiding this refund would put more than its total of ${order.total.toFixed(2)} on it.`,
          );
        }
      } else if (proforma) {
        const held = await heldOnProforma(tx, proforma.id);
        if (held.plus(refund.amount).gt(proforma.total)) {
          throw new AppError(
            "CONFLICT",
            `${proforma.number} has been paid again since; voiding this refund would put more than its total of ${proforma.total.toFixed(2)} on it.`,
          );
        }
      }
      if (refund.kind === "CREDIT" && refund.partyId) {
        const credit = await accountCredit(tx, companyId, refund.partyId);
        if (credit.lt(refund.amount)) {
          throw new AppError(
            "CONFLICT",
            `Only ${credit.toFixed(2)} of this ${refund.amount.toFixed(2)} credit is still on the buyer's account; the rest has been used.`,
          );
        }
      }

      if (refund.journalEntryId) {
        await reverseJournalEntry(tx, refund.journalEntryId, {
          description: `Void of refund ${refund.number}: ${reason}`,
          postedById: ctx.user.id,
        });
      }
      await tx.refund.update({
        where: { id: refund.id },
        data: { voidedAt: new Date(), voidReason: reason },
      });
      if (refund.orderId) {
        await refreshOrderPayments(tx, refund.orderId);
      } else if (refund.proformaId) {
        // The advance may be paid in full again: production starts as if it had just come in.
        const proforma = await refreshProformaPayments(tx, refund.proformaId);
        await startProductionIfAdvancePaid(tx, ctx, proforma, new Date(), meta);
      }
      await auditInCompany(
        ctx,
        meta,
        {
          action: "STATUS_CHANGE",
          entityType: "Refund",
          entityId: refund.id,
          summary: `Voided refund ${refund.number} (${refund.amount.toFixed(2)} ${REFUND_KIND_TEXT[refund.kind]}): ${reason}`,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
  return getRefund(ctx, refundId);
}

export async function listRefunds(ctx: CompanyContext, raw: unknown = {}) {
  const q = listRefundsSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.refund.findMany({
    where: {
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.proformaId ? { proformaId: q.proformaId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(start || end
        ? { refundDate: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    include: {
      party: { select: { id: true, code: true, name: true } },
      account: { select: { id: true, code: true, name: true } },
      order: { select: { id: true, number: true } },
      proforma: { select: { id: true, number: true } },
    },
    orderBy: [{ refundDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}

/**
 * Refund voucher data. `heldBefore` / `heldAfter` are what its proforma (or
 * order) held just before and after it, by date, so a voucher printed again
 * later still shows the position it was written for. Null for a refund of
 * credit on account.
 */
export async function getRefund(ctx: CompanyContext, refundId: string) {
  const refund = await ctx.db.refund.findUnique({
    where: { id: refundId },
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
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          customerName: true,
          customerPhone: true,
          shippingAddress: true,
        },
      },
      proforma: { select: { id: true, number: true, status: true, total: true } },
      account: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!refund) throw new AppError("NOT_FOUND", "Refund not found.");
  // A proforma's refunds move onto its order when it converts; the voucher stays with the proforma.
  const against = refund.proformaId
    ? { proformaId: refund.proformaId }
    : refund.orderId
      ? { orderId: refund.orderId }
      : null;
  let heldBefore: Prisma.Decimal | null = null;
  if (against) {
    const { refundDate: date, createdAt } = refund;
    const received = await ctx.db.payment.aggregate({
      where: { ...against, direction: "RECEIVED", paymentDate: { lte: date } },
      _sum: { amount: true },
    });
    const earlier = await ctx.db.refund.aggregate({
      where: {
        ...against,
        voidedAt: null,
        OR: [
          { refundDate: { lt: date } },
          { refundDate: date, createdAt: { lt: createdAt } },
          { refundDate: date, createdAt, id: { lt: refund.id } },
        ],
      },
      _sum: { amount: true },
    });
    heldBefore = money(received._sum.amount ?? 0).minus(money(earlier._sum.amount ?? 0));
  }
  return {
    ...refund,
    heldBefore,
    heldAfter: heldBefore ? heldBefore.minus(refund.amount) : null,
    letterhead: await letterhead(ctx),
  };
}
