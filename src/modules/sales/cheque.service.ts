import type { Prisma } from "@prisma/client";

import { dateColumn, dateOnly, dayRange, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertNotWalkIn } from "@/modules/parties/walk-in";
import { openDuesOf } from "@/modules/sales/credit.service";
import { assertCanRecordReceipts, receivePaymentTx } from "@/modules/sales/payment.service";
import { assertProofFile } from "@/modules/sales/proof.service";
import { isClosedProforma } from "@/modules/sales/rules";
import {
  bounceChequeSchema,
  clearChequeSchema,
  listChequesSchema,
  recordChequeSchema,
} from "@/modules/sales/schemas";
import { money } from "@/modules/sales/totals";

/*
 * Cheques received from buyers. A cheque is only a promise until the bank pays
 * it, so recording one posts nothing and leaves the order's due as it was:
 *   PENDING  kept in the cheque list; the books and the dues are untouched
 *   CLEARED  the money receipt is recorded on the day the bank credited it,
 *            into the bank account it was deposited in (Dr Bank), exactly as a
 *            payment taken then (receivePaymentTx), and it gets the cheque's photo
 *   BOUNCED  nothing is posted; the reason is kept
 * A cheque on an order that has been paid meanwhile, or more than is left on a
 * proforma, clears onto the buyer's account instead: it pays their oldest dues
 * and the rest is kept as advance balance.
 */

type Tx = Prisma.TransactionClient;
type RecordInput = ReturnType<typeof recordChequeSchema.parse>;

/** Records a cheque as pending (inside a transaction). */
export async function recordChequeTx(
  tx: Tx,
  ctx: CompanyContext,
  input: RecordInput,
  meta?: RequestMeta,
) {
  assertCanRecordReceipts(ctx);
  const companyId = ctx.company.id;
  let partyId: string | null = null;
  let label: string;
  if (input.orderId) {
    const order = await tx.salesOrder.findFirst({
      where: { id: input.orderId, companyId },
      select: { number: true, status: true, partyId: true },
    });
    if (!order) throw new AppError("NOT_FOUND", "Order not found.");
    if (order.status === "CANCELLED") throw new AppError("CONFLICT", "This order is cancelled.");
    partyId = order.partyId;
    label = order.number;
  } else if (input.proformaId) {
    const proforma = await tx.proformaInvoice.findFirst({
      where: { id: input.proformaId, companyId },
      select: { number: true, status: true, partyId: true },
    });
    if (!proforma) throw new AppError("NOT_FOUND", "Proforma invoice not found.");
    if (isClosedProforma(proforma.status)) {
      throw new AppError("CONFLICT", `${proforma.number} takes no more payments.`);
    }
    partyId = proforma.partyId;
    label = proforma.number;
  } else {
    const party = await tx.party.findFirst({ where: { id: input.partyId, companyId } });
    if (!party) throw new AppError("NOT_FOUND", "Buyer not found.");
    if (party.kind === "SUPPLIER") {
      throw new AppError("VALIDATION", `${party.name} is not a buyer.`);
    }
    assertNotWalkIn(party, "Take a walk-in customer's cheque against their order.");
    partyId = party.id;
    label = `${party.name}'s account (${party.code})`;
  }
  if (input.proofFileId) await assertProofFile(ctx, tx, input.proofFileId);
  const receivedAt = input.receivedAt ?? new Date();
  const amount = money(input.amount);
  const cheque = await tx.cheque.create({
    data: {
      companyId,
      partyId,
      orderId: input.orderId ?? null,
      proformaId: input.proformaId ?? null,
      amount,
      chequeNo: input.chequeNo,
      bankName: input.bankName ?? null,
      chequeDate: dateColumn(input.chequeDate ?? localDay(receivedAt, ctx.company.timezone)),
      receivedAt,
      allocations: input.allocations?.length
        ? input.allocations.map((a) => ({ orderId: a.orderId, amount: a.amount }))
        : undefined,
      oldestFirst: input.oldestFirst ?? false,
      proofFileId: input.proofFileId ?? null,
      notes: input.notes ?? null,
      createdById: ctx.user.id,
    },
  });
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "Cheque",
      entityId: cheque.id,
      summary: `Cheque ${cheque.chequeNo}${cheque.bankName ? ` (${cheque.bankName})` : ""} for ${amount.toFixed(2)} received — ${label}; pending until cleared`,
    },
    tx,
  );
  return cheque;
}

export async function recordCheque(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = recordChequeSchema.parse(raw);
  return prisma.$transaction((tx) => recordChequeTx(tx, ctx, input, meta), { timeout: 30_000 });
}

async function lockPending(tx: Tx, ctx: CompanyContext, chequeId: string) {
  await lockRow(tx, "Cheque", chequeId);
  const cheque = await tx.cheque.findFirst({
    where: { id: chequeId, companyId: ctx.company.id },
    include: {
      order: {
        select: {
          id: true,
          total: true,
          paidAmount: true,
          status: true,
          invoice: { select: { status: true } },
        },
      },
      proforma: { select: { id: true, total: true, advancePaid: true, status: true } },
    },
  });
  if (!cheque) throw new AppError("NOT_FOUND", "Cheque not found.");
  if (cheque.status !== "PENDING") {
    throw new AppError(
      "CONFLICT",
      `Cheque ${cheque.chequeNo} is already ${cheque.status.toLowerCase()}.`,
    );
  }
  return cheque;
}

/**
 * The split saved with a cheque on account, cut to what each invoice still
 * owes now (some may have been paid while the cheque was pending).
 */
async function savedAllocations(
  tx: Tx,
  companyId: string,
  partyId: string,
  value: Prisma.JsonValue | null,
) {
  if (!Array.isArray(value)) return undefined;
  const dues = new Map(
    (await openDuesOf(tx, companyId, partyId)).map((d) => [d.orderId, d.dueAmount]),
  );
  const lines = value.flatMap((v) => {
    const line = v as { orderId?: unknown; amount?: unknown };
    if (typeof line.orderId !== "string" || typeof line.amount !== "number") return [];
    const due = dues.get(line.orderId);
    if (!due || due.lte(0)) return [];
    const amount = Math.min(line.amount, Number(due.toFixed(2)));
    return amount > 0 ? [{ orderId: line.orderId, amount }] : [];
  });
  return lines.length > 0 ? lines : undefined;
}

/**
 * Marks a pending cheque cleared: the money receipt is recorded on the day the
 * bank credited it, into the bank account chosen (the main bank by default).
 */
export async function clearCheque(
  ctx: CompanyContext,
  chequeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanRecordReceipts(ctx);
  const input = clearChequeSchema.parse(raw);
  const today = localDay(new Date(), ctx.company.timezone);
  const clearedOn = input.clearedOn ?? today;
  if (clearedOn > today) {
    throw new AppError("VALIDATION", "A cheque cannot clear on a day still to come.", {
      clearedOn: ["Choose today or an earlier day"],
    });
  }
  return prisma.$transaction(
    async (tx) => {
      const cheque = await lockPending(tx, ctx, chequeId);
      const written = dateOnly(cheque.chequeDate);
      if (clearedOn < written) {
        throw new AppError(
          "VALIDATION",
          `The cheque is dated ${written}; it cannot clear before.`,
          {
            clearedOn: [`On or after ${written}`],
          },
        );
      }
      const amount = cheque.amount;
      const base = {
        amount: Number(amount.toFixed(2)),
        method: "CHEQUE" as const,
        accountId: input.accountId,
        paymentDate: clearedOn === today ? undefined : dateColumn(clearedOn),
        reference: `Cheque ${cheque.chequeNo}${cheque.bankName ? `, ${cheque.bankName}` : ""}`,
        notes: cheque.notes,
      };
      // Where the money goes now: as recorded, or the buyer's account when that no longer fits.
      let target:
        | { orderId: string; extra?: "ADVANCE" }
        | { proformaId: string }
        | {
            partyId: string;
            allocations?: Array<{ orderId: string; amount: number }>;
            oldestFirst?: boolean;
          };
      if (cheque.order) {
        const o = cheque.order;
        const due = o.total.minus(o.paidAmount);
        const live = o.status !== "CANCELLED" && due.gt(0);
        const invoiced = o.invoice !== null && o.invoice.status !== "VOID";
        if (live && amount.lte(due)) target = { orderId: o.id };
        else if (live && invoiced && cheque.partyId) target = { orderId: o.id, extra: "ADVANCE" };
        else if (cheque.partyId) target = { partyId: cheque.partyId, oldestFirst: true };
        else {
          throw new AppError(
            "CONFLICT",
            `Only ${Math.max(Number(due.toFixed(2)), 0).toFixed(2)} is due on this walk-in order now. Mark the cheque bounced, or give the money back.`,
          );
        }
      } else if (cheque.proforma) {
        const p = cheque.proforma;
        if (!isClosedProforma(p.status) && amount.lte(p.total.minus(p.advancePaid))) {
          target = { proformaId: p.id };
        } else if (cheque.partyId) target = { partyId: cheque.partyId, oldestFirst: true };
        else throw new AppError("CONFLICT", "The proforma takes no more payments.");
      } else if (cheque.partyId) {
        const allocations = await savedAllocations(
          tx,
          ctx.company.id,
          cheque.partyId,
          cheque.allocations,
        );
        target = allocations
          ? { partyId: cheque.partyId, allocations }
          : { partyId: cheque.partyId, oldestFirst: cheque.oldestFirst };
      } else {
        throw new AppError("CONFLICT", "This cheque has no buyer or order any more.");
      }
      const received = await receivePaymentTx(tx, ctx, { ...base, ...target }, meta);
      const payment = received.payment;
      await tx.payment.update({
        where: { id: payment.id },
        data: { proofFileId: cheque.proofFileId },
      });
      await tx.cheque.update({
        where: { id: cheque.id },
        data: { status: "CLEARED", clearedAt: new Date(), paymentId: payment.id },
      });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "STATUS_CHANGE",
          entityType: "Cheque",
          entityId: cheque.id,
          summary: `Cheque ${cheque.chequeNo} cleared on ${clearedOn}: payment ${payment.number} recorded`,
        },
        tx,
      );
      return { chequeId: cheque.id, ...received };
    },
    { timeout: 30_000 },
  );
}

/** Marks a pending cheque bounced: nothing is posted, the reason is kept. */
export async function bounceCheque(
  ctx: CompanyContext,
  chequeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanRecordReceipts(ctx);
  const input = bounceChequeSchema.parse(raw);
  if (input.bouncedOn && input.bouncedOn > localDay(new Date(), ctx.company.timezone)) {
    throw new AppError("VALIDATION", "A cheque cannot bounce on a day still to come.", {
      bouncedOn: ["Choose today or an earlier day"],
    });
  }
  return prisma.$transaction(async (tx) => {
    const cheque = await lockPending(tx, ctx, chequeId);
    // The start of that day in company time, so lists and this month's figures agree.
    const bouncedAt = input.bouncedOn
      ? dayRange(input.bouncedOn, undefined, ctx.company.timezone).start!
      : new Date();
    const updated = await tx.cheque.update({
      where: { id: cheque.id },
      data: { status: "BOUNCED", bouncedAt, bounceReason: input.reason },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Cheque",
        entityId: cheque.id,
        summary: `Cheque ${cheque.chequeNo} for ${cheque.amount.toFixed(2)} bounced: ${input.reason}`,
      },
      tx,
    );
    return updated;
  });
}

const chequeRow = {
  id: true,
  amount: true,
  chequeNo: true,
  bankName: true,
  chequeDate: true,
  receivedAt: true,
  status: true,
  clearedAt: true,
  bouncedAt: true,
  bounceReason: true,
  proofFileId: true,
  party: { select: { id: true, code: true, name: true } },
  order: { select: { id: true, number: true, customerName: true } },
  proforma: { select: { id: true, number: true } },
  payment: { select: { id: true, number: true, paymentDate: true } },
} as const satisfies Prisma.ChequeSelect;

/** Cheques, newest first: by status, buyer or order. */
export async function listCheques(ctx: CompanyContext, raw: unknown = {}) {
  const q = listChequesSchema.parse(raw);
  const take = q.take ?? 50;
  const rows = await ctx.db.cheque.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
    },
    select: chequeRow,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}

export type ChequeRow = Prisma.ChequeGetPayload<{ select: typeof chequeRow }>;

/** Cheque totals for the payments dashboard: pending now, bounced this month. */
export async function chequeFigures(ctx: CompanyContext, monthStart: Date) {
  const [pending, bounced] = await Promise.all([
    ctx.db.cheque.aggregate({
      where: { status: "PENDING" },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    ctx.db.cheque.aggregate({
      where: { status: "BOUNCED", bouncedAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);
  return {
    pending: { count: pending._count._all, value: (pending._sum.amount ?? 0).toFixed(2) },
    bounced: { count: bounced._count._all, value: (bounced._sum.amount ?? 0).toFixed(2) },
  };
}
