import { Prisma } from "@prisma/client";

import { dayRange, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { assertAllowed } from "@/lib/verdict";
import { money } from "@/modules/accounts/balances";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { assertCanPayMoney } from "@/modules/accounts/money-guards";
import { canVoidSupplierPayment } from "@/modules/accounts/rules";
import {
  listSupplierPaymentsSchema,
  paySupplierSchema,
  voidSchema,
} from "@/modules/accounts/schemas";
import { supplierProjectBalances } from "@/modules/accounts/supplier-projects";
import { settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { recordPartyActivity } from "@/modules/parties/party.service";

/*
 * Paying a supplier on account (not against one bill): one payment voucher,
 *   Dr Payable (supplier)   Cr Cash / Bank / Wallet
 * The supplier's oldest dues are then settled first: the opening balance, bills,
 * assets bought on credit, Due expenses. A payment made for one production
 * project settles that project's bills first instead, and the rest goes to the
 * oldest dues as usual. Anything left over stays on their ledger as an advance
 * and settles the next bill automatically. Bill paid / due figures are
 * recomputed from the supplier's ledger every time (settleSupplierBills), so
 * voiding a payment or a bill keeps them in step. A payment is void once its
 * journal entry is reversed.
 */

const TX_OPTIONS = { timeout: 30_000 };

const paymentInclude = {
  party: { select: { id: true, code: true, name: true } },
  account: { select: { id: true, code: true, name: true } },
  supplierBill: { select: { id: true, number: true } },
  project: { select: { id: true, code: true, name: true } },
  journalEntry: { select: { id: true, number: true, isReversed: true } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

function presentPayment(p: PaymentRow) {
  return {
    id: p.id,
    number: p.number,
    paymentDate: p.paymentDate,
    method: p.method,
    amount: p.amount.toFixed(2),
    reference: p.reference,
    notes: p.notes,
    supplier: p.party,
    account: p.account,
    /** null: paid on account (settles the oldest open bills). */
    bill: p.supplierBill,
    /** The production project it was paid for (settles that project's bills first). */
    project: p.project,
    journalEntry: p.journalEntry,
    isVoid: p.journalEntry?.isReversed ?? false,
    createdAt: p.createdAt,
  };
}

export async function listSupplierPayments(ctx: CompanyContext, raw: unknown = {}) {
  const q = listSupplierPaymentsSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.payment.findMany({
    where: {
      direction: "PAID",
      partyId: q.supplierId ?? { not: null },
      ...(start || end
        ? { paymentDate: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    include: paymentInclude,
    orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items: items.map(presentPayment), nextCursor: hasMore ? items.at(-1)?.id : undefined };
}

async function supplierSummary(ctx: CompanyContext, supplierId: string) {
  const [balance, openBills] = await Promise.all([
    getPartyBalance(ctx, supplierId),
    ctx.db.supplierBill.findMany({
      where: { supplierId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      select: { id: true, number: true, billDate: true, totalAmount: true, dueAmount: true },
      orderBy: [{ billDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return {
    /** What the company owes the supplier now (negative: the supplier holds an advance). */
    payable: balance.neg().toFixed(2),
    openBills: openBills.map((b) => ({
      ...b,
      totalAmount: b.totalAmount.toFixed(2),
      dueAmount: b.dueAmount.toFixed(2),
    })),
  };
}

export async function getSupplierPayment(ctx: CompanyContext, paymentId: string) {
  const payment = await ctx.db.payment.findUnique({
    where: { id: paymentId },
    include: paymentInclude,
  });
  if (!payment || payment.direction !== "PAID" || !payment.partyId) {
    throw new AppError("NOT_FOUND", "Supplier payment not found.");
  }
  return { ...presentPayment(payment), supplierNow: await supplierSummary(ctx, payment.partyId) };
}

/**
 * Accounts pays a supplier a lump sum; it settles their oldest open bills, or
 * first those of the project it is paid for.
 */
export async function paySupplier(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanPayMoney(ctx, "Only Accounts can pay suppliers.");
  const input = paySupplierSchema.parse(raw);
  const supplier = await ctx.db.party.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw new AppError("NOT_FOUND", "Supplier not found.");
  if (supplier.kind === "BUYER") {
    throw new AppError("VALIDATION", `${supplier.name} is not set up as a supplier.`);
  }
  if (supplier.status === "CLOSED") {
    throw new AppError("CONFLICT", `${supplier.name}'s account is closed.`);
  }
  const companyId = ctx.company.id;
  const amount = money(input.amount);
  const paymentDate = input.paymentDate
    ? toInstant(input.paymentDate, ctx.company.timezone)
    : new Date();
  const project = input.projectId
    ? await ctx.db.productionProject.findUnique({
        where: { id: input.projectId },
        select: { id: true, code: true },
      })
    : null;
  if (input.projectId && !project) throw new AppError("NOT_FOUND", "Production project not found.");
  if (project) {
    const owed = (await supplierProjectBalances(prisma, companyId, supplier.id)).get(project.id);
    if (!owed || owed.due.lte(0)) {
      throw new AppError(
        "VALIDATION",
        `Nothing is due to ${supplier.name} for ${project.code}. Pay without a project to settle their oldest bills.`,
        { projectId: [`Nothing is due for ${project.code}.`] },
      );
    }
  }
  const forWhat = project ? `for ${project.code}` : "on account";

  const result = await prisma.$transaction(async (tx) => {
    const paidFrom = await cashAccountFor(tx, companyId, input.method, input.accountId);
    const acc = await ensureControlAccounts(companyId, tx);
    const payment = await tx.payment.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "PAYMENT_VOUCHER"),
        direction: "PAID",
        method: input.method,
        partyId: supplier.id,
        amount,
        paymentDate,
        accountId: paidFrom,
        projectId: project?.id ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      },
    });
    const entry = await postJournalEntry(tx, {
      companyId,
      date: paymentDate,
      description: `Payment ${payment.number} to ${supplier.name} (${forWhat})${
        input.notes ? ` — ${input.notes}` : ""
      }`,
      sourceType: "PAYMENT",
      sourceId: payment.id,
      postedById: ctx.user.id,
      lines: [
        {
          accountId: acc.PAYABLE,
          partyId: supplier.id,
          debit: amount,
          memo: project ? `For ${project.code}` : "On account",
        },
        { accountId: paidFrom, credit: amount, memo: input.reference ?? undefined },
      ],
    });
    await tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });
    const settled = await settleSupplierBills(tx, companyId, supplier.id);
    await recordPartyActivity(supplier.id, paymentDate, tx);
    const appliedTo = settled.changed
      .filter((c) => c.paidAfter.gt(c.paidBefore))
      .map((c) => ({
        billId: c.billId,
        number: c.number,
        amount: c.paidAfter.minus(c.paidBefore).toFixed(2),
        dueAfter: c.dueAfter.toFixed(2),
        status: c.status,
      }));
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Payment",
        entityId: payment.id,
        summary: `Paid ${amount.toFixed(2)} (${input.method}) ${payment.number} to ${supplier.name} ${forWhat}${
          appliedTo.length > 0
            ? `; settles ${appliedTo.map((a) => `${a.number} ${a.amount}`).join(", ")}`
            : ""
        }${settled.advanceLeft.gt(0) ? `; advance left ${settled.advanceLeft.toFixed(2)}` : ""}`,
      },
      tx,
    );
    return { paymentId: payment.id, appliedTo, advanceLeft: settled.advanceLeft };
  }, TX_OPTIONS);

  return {
    ...(await getSupplierPayment(ctx, result.paymentId)),
    appliedTo: result.appliedTo,
    advanceLeft: result.advanceLeft.toFixed(2),
  };
}

/**
 * Voids a payment to a supplier made by mistake (on account or against a bill):
 * its entry is reversed (the money is back in the cash or bank account) and the
 * supplier's bills are settled again without it.
 */
export async function voidSupplierPayment(
  ctx: CompanyContext,
  paymentId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanPayMoney(ctx, "Only Accounts can void supplier payments.");
  const { reason } = voidSchema.parse(raw);
  const payment = await ctx.db.payment.findUnique({
    where: { id: paymentId },
    include: {
      party: { select: { id: true, name: true } },
      account: { select: { subType: true } },
      journalEntry: { select: { id: true, isReversed: true } },
    },
  });
  if (!payment || payment.direction !== "PAID" || !payment.party) {
    throw new AppError("NOT_FOUND", "Supplier payment not found.");
  }
  // The money comes back into the cash / bank account.
  assertAllowed(
    canVoidSupplierPayment(ctx, { ...payment, accountSubType: payment.account.subType }),
  );
  const supplier = payment.party;
  const entryId = payment.journalEntry!.id;

  await prisma.$transaction(async (tx) => {
    const reversal = await reverseJournalEntry(tx, entryId, {
      description: `Void ${payment.number} (${supplier.name}): ${reason}`,
      postedById: ctx.user.id,
    });
    const settled = await settleSupplierBills(tx, ctx.company.id, supplier.id);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Payment",
        entityId: payment.id,
        summary: `Voided ${payment.number} (${payment.amount.toFixed(2)} to ${supplier.name}) with ${reversal.number}: ${reason}${
          settled.changed.length > 0
            ? `; due again on ${settled.changed.map((c) => c.number).join(", ")}`
            : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getSupplierPayment(ctx, payment.id);
}
