import type {
  ExpenseCategory,
  Party,
  PaymentMethod,
  Prisma,
  ProductionStatus,
} from "@prisma/client";
import type { z } from "zod";

import { addDays, dayRange, localDay, toInstant } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { formatAmount, formatInstantDay } from "@/lib/format";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { lockSupplierAccount, settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertClaimNotPaidBack } from "@/modules/hr/claim-guard";
import { projectMaterialUsage } from "@/modules/materials/usage";
import { assertPartyCanTransact, recordPartyActivity } from "@/modules/parties/party.service";
import { splitEqually } from "@/modules/production/batch-money";
import { money, ZERO } from "@/modules/production/costing";
import {
  assertCanPayOut,
  assertCanSeeProductionCosts,
  isProjectClosed,
  lockOpenProjects,
  projectCostSummaries,
  projectCostSummary,
  refreshProjectCosts,
} from "@/modules/production/project-costs";
import { canPayBill, canVoidBill } from "@/modules/production/rules";
import {
  addBatchCostSchema,
  addProjectCostSchema,
  costHeadSchema,
  createBillSchema,
  listBillsSchema,
  listCostHeadsSchema,
  payBillSchema,
  updateCostHeadSchema,
  voidSchema,
} from "@/modules/production/schemas";

/*
 * Cost allocation for production batches (blueprint "Cash vs. Due Purchases"
 * and "Split Bill Logic"). Every cost names an expense head (Fabric, Sewing...)
 * and is either paid now from cash / bank or left Due on the supplier's ledger.
 * Production Managers record Due bills; money paid out needs Accounts.
 */

type Tx = Prisma.TransactionClient;
type BillInput = z.output<typeof createBillSchema>;

const TX_OPTIONS = { timeout: 30_000 };

// =============================================================================
// Cost heads
// =============================================================================

export const DEFAULT_PRODUCTION_COST_HEADS: ReadonlyArray<{
  name: string;
  category: ExpenseCategory;
}> = [
  { name: "Fabric", category: "RAW_MATERIAL" },
  { name: "Trims & Accessories", category: "RAW_MATERIAL" },
  { name: "Cutting", category: "PRODUCTION" },
  { name: "Sewing (CM)", category: "PRODUCTION" },
  { name: "Wash", category: "PRODUCTION" },
  { name: "Print & Embroidery", category: "PRODUCTION" },
  { name: "Finishing & Packing", category: "PRODUCTION" },
  { name: "Production Transport", category: "PRODUCTION" },
  { name: "Sampling", category: "PRODUCTION" },
  // FOB projects: the finished goods bought from the FOB supplier, and the check on them.
  { name: "FOB Goods", category: "PRODUCTION" },
  { name: "QC & Inspection", category: "PRODUCTION" },
  { name: "Other Production Cost", category: "PRODUCTION" },
];

/** Gives a company the default production cost heads the first time they are needed. */
export async function ensureProductionCostHeads(companyId: string, db: Db = prisma) {
  const existing = await db.expenseHead.count({ where: { companyId, isProductionCost: true } });
  if (existing > 0) return;
  await db.expenseHead.createMany({
    data: DEFAULT_PRODUCTION_COST_HEADS.map((h) => ({
      companyId,
      name: h.name,
      category: h.category,
      isProductionCost: true,
    })),
    skipDuplicates: true,
  });
}

const headSelect = { id: true, name: true, category: true, isActive: true } as const;

export async function listCostHeads(ctx: CompanyContext, raw: unknown = {}) {
  const q = listCostHeadsSchema.parse(raw);
  await ensureProductionCostHeads(ctx.company.id);
  return ctx.db.expenseHead.findMany({
    where: { isProductionCost: true, ...(q.includeInactive ? {} : { isActive: true }) },
    select: headSelect,
    orderBy: { name: "asc" },
  });
}

async function assertHeadNameFree(ctx: CompanyContext, name: string, exceptId?: string) {
  const clash = await ctx.db.expenseHead.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (clash) throw new AppError("CONFLICT", `A cost head called "${clash.name}" already exists.`);
}

export async function createCostHead(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = costHeadSchema.parse(raw);
  await assertHeadNameFree(ctx, input.name);
  const head = await ctx.db.expenseHead.create({
    data: {
      companyId: ctx.company.id,
      name: input.name,
      category: input.category ?? "PRODUCTION",
      isProductionCost: true,
    },
    select: headSelect,
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "ExpenseHead",
    entityId: head.id,
    summary: `Added production cost head "${head.name}"`,
  });
  return head;
}

export async function updateCostHead(
  ctx: CompanyContext,
  headId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateCostHeadSchema.parse(raw);
  const head = await ctx.db.expenseHead.findUnique({ where: { id: headId } });
  if (!head?.isProductionCost) throw new AppError("NOT_FOUND", "Cost head not found.");
  if (input.name && input.name !== head.name) await assertHeadNameFree(ctx, input.name, head.id);
  const updated = await ctx.db.expenseHead.update({
    where: { id: head.id },
    data: { name: input.name, isActive: input.isActive },
    select: headSelect,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "ExpenseHead",
    entityId: head.id,
    summary: `Updated cost head "${updated.name}"${input.isActive === false ? " (archived)" : ""}`,
  });
  return updated;
}

async function loadCostHeads(ctx: CompanyContext, ids: string[]) {
  const unique = [...new Set(ids)];
  const heads = await ctx.db.expenseHead.findMany({
    where: { id: { in: unique }, isProductionCost: true, isActive: true },
  });
  if (heads.length !== unique.length) {
    throw new AppError("VALIDATION", "Choose an active production cost head for every cost.");
  }
  return new Map(heads.map((h) => [h.id, h]));
}

// =============================================================================
// Supplier bills (Split Bill) and supplier payments
// =============================================================================

/** A bill without the supplier's number counts as the same when its total matches within this many days. */
export const DUPLICATE_BILL_DAYS = 3;

/**
 * Stops a bill or cost that looks entered already (not void), so the same bill
 * is not booked twice: the supplier's same bill number; without a number, the
 * same supplier and total within DUPLICATE_BILL_DAYS days; without a supplier,
 * the same project, cost head and amount on the same day. A warning only: sent
 * again with allowDuplicate, it goes through. The CONFLICT carries the match
 * in details.allowDuplicate.
 */
async function assertNotDuplicate(
  ctx: CompanyContext,
  entry: {
    total: Prisma.Decimal;
    date: Date;
    supplier?: { id: string; name: string };
    supplierRef?: string | null;
    projectId?: string;
    headId?: string;
  },
) {
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  const amount = (value: Prisma.Decimal.Value) => formatAmount(value, 2, currency);
  const day = localDay(entry.date, tz);
  let match: string | null = null;
  if (entry.supplier) {
    const ref = entry.supplierRef?.trim();
    const near = dayRange(
      addDays(day, -DUPLICATE_BILL_DAYS),
      addDays(day, DUPLICATE_BILL_DAYS),
      tz,
    );
    const bill = await ctx.db.supplierBill.findFirst({
      where: {
        supplierId: entry.supplier.id,
        status: { not: "VOID" },
        ...(ref
          ? { supplierRef: { equals: ref, mode: "insensitive" } }
          : { totalAmount: entry.total, billDate: { gte: near.start, lt: near.end } }),
      },
      select: { number: true, supplierRef: true, totalAmount: true, billDate: true },
      orderBy: [{ billDate: "desc" }, { id: "desc" }],
    });
    if (bill) {
      const what = `${amount(bill.totalAmount)} on ${formatInstantDay(bill.billDate, tz)}`;
      match = ref
        ? `${bill.number} from ${entry.supplier.name} already has their bill number ${bill.supplierRef}: ${what}. Is this the same bill?`
        : `${bill.number} from ${entry.supplier.name} is also ${what}. Is this the same bill?`;
    }
  } else if (entry.projectId && entry.headId) {
    const sameDay = dayRange(day, day, tz);
    const cost = await ctx.db.expense.findFirst({
      where: {
        projectId: entry.projectId,
        headId: entry.headId,
        amount: entry.total,
        voidedAt: null,
        date: { gte: sameDay.start, lt: sameDay.end },
      },
      select: { number: true, head: { select: { name: true } } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
    if (cost) {
      match = `${cost.number} is also ${amount(entry.total)} for ${cost.head.name} on this project, the same day. Is this the same cost?`;
    }
  }
  if (match) throw new AppError("CONFLICT", match, { allowDuplicate: [match] });
}

/** Checks run before the transaction: supplier, cost heads and attachment. */
async function prepareBill(
  ctx: CompanyContext,
  input: Pick<BillInput, "supplierId" | "attachmentId" | "allocations">,
) {
  const supplier = await assertPartyCanTransact(ctx, input.supplierId, "PURCHASE");
  const heads = await loadCostHeads(
    ctx,
    input.allocations.map((a) => a.expenseHeadId),
  );
  if (input.attachmentId) {
    const file = await ctx.db.fileAsset.findUnique({ where: { id: input.attachmentId } });
    if (!file) throw new AppError("NOT_FOUND", "Attachment not found.");
  }
  return { supplier, heads };
}

/**
 * Saves a supplier bill split across projects: Dr Work in Progress per share,
 * Cr Payable (supplier). A Cash/Bank bill is paid in full straight away.
 */
async function createBillTx(
  tx: Tx,
  ctx: CompanyContext,
  input: BillInput,
  prepared: { supplier: Party; heads: Map<string, { id: string; name: string }> },
  meta?: RequestMeta,
) {
  const companyId = ctx.company.id;
  const { supplier, heads } = prepared;
  // The supplier's account first, as for paying or voiding their bills.
  await lockSupplierAccount(tx, companyId, supplier.id);
  const projects = await lockOpenProjects(
    tx,
    companyId,
    input.allocations.map((a) => a.projectId),
    "no more costs can be added",
  );
  const total = input.allocations.reduce((s, a) => s.plus(money(a.amount)), ZERO);
  const billDate = input.billDate ? toInstant(input.billDate, ctx.company.timezone) : new Date();
  const acc = await ensureControlAccounts(companyId, tx);

  const bill = await tx.supplierBill.create({
    data: {
      companyId,
      number: await nextDocumentNumber(tx, companyId, "SUPPLIER_BILL"),
      supplierRef: input.supplierRef ?? null,
      supplierId: supplier.id,
      billDate,
      totalAmount: total,
      paymentType: input.paymentType,
      dueAmount: total,
      attachmentId: input.attachmentId ?? null,
      notes: input.notes ?? null,
      allocations: {
        create: input.allocations.map((a) => ({
          projectId: a.projectId,
          expenseHeadId: a.expenseHeadId,
          amount: money(a.amount),
          description: a.description ?? null,
        })),
      },
    },
  });
  const entry = await postJournalEntry(tx, {
    companyId,
    date: billDate,
    description: `Bill ${bill.number} — ${supplier.name}${bill.supplierRef ? ` (${bill.supplierRef})` : ""}`,
    sourceType: "SUPPLIER_BILL",
    sourceId: bill.id,
    postedById: ctx.user.id,
    lines: [
      ...input.allocations.map((a) => ({
        accountId: acc.WORK_IN_PROGRESS,
        debit: money(a.amount),
        memo: `${projects.get(a.projectId)!.code} · ${heads.get(a.expenseHeadId)!.name}`,
      })),
      {
        accountId: acc.PAYABLE,
        partyId: supplier.id,
        credit: total,
        memo: bill.supplierRef ?? undefined,
      },
    ],
  });
  await tx.supplierBill.update({ where: { id: bill.id }, data: { journalEntryId: entry.id } });
  await refreshProjectCosts(tx, companyId, [...projects.keys()]);
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "SupplierBill",
      entityId: bill.id,
      summary: `Bill ${bill.number} from ${supplier.name}: ${total.toFixed(2)} ${
        input.paymentType === "DUE" ? "due" : "paid now"
      }, for ${[...projects.values()].map((p) => p.code).join(", ")}`,
    },
    tx,
  );
  if (input.paymentType === "CASH_BANK") {
    await payBillTx(
      tx,
      ctx,
      bill.id,
      {
        amount: total,
        method: input.method ?? "CASH",
        accountId: input.accountId,
        reference: input.reference,
        paymentDate: billDate,
      },
      meta,
    );
  }
  // An advance already paid to the supplier settles a Due bill straight away.
  await settleSupplierBills(tx, companyId, supplier.id);
  await recordPartyActivity(supplier.id, billDate, tx);
  return bill.id;
}

export async function createBill(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createBillSchema.parse(raw);
  if (input.paymentType === "CASH_BANK") assertCanPayOut(ctx);
  const prepared = await prepareBill(ctx, input);
  if (!input.allowDuplicate) {
    await assertNotDuplicate(ctx, {
      total: input.allocations.reduce((s, a) => s.plus(money(a.amount)), ZERO),
      date: input.billDate ? toInstant(input.billDate, ctx.company.timezone) : new Date(),
      supplier: prepared.supplier,
      supplierRef: input.supplierRef,
    });
  }
  const billId = await prisma.$transaction(
    (tx) => createBillTx(tx, ctx, input, prepared, meta),
    TX_OPTIONS,
  );
  return getBill(ctx, billId);
}

type PayOutInput = {
  amount: Prisma.Decimal | number;
  method: PaymentMethod;
  accountId?: string;
  paymentDate?: Date;
  reference?: string | null;
  notes?: string | null;
};

/** Pays (part of) a bill: Dr Payable (supplier), Cr Cash / Bank / Wallet. */
export async function payBillTx(
  tx: Tx,
  ctx: CompanyContext,
  billId: string,
  input: PayOutInput,
  meta?: RequestMeta,
) {
  assertCanPayOut(ctx);
  const companyId = ctx.company.id;
  // The supplier's account before the bill, as every payment, void or return on a
  // supplier's bills does, so two of them queue up instead of deadlocking.
  const owner = await tx.supplierBill.findFirst({
    where: { id: billId, companyId },
    select: { supplierId: true },
  });
  if (owner) await lockSupplierAccount(tx, companyId, owner.supplierId);
  await lockRow(tx, "SupplierBill", billId);
  const bill = await tx.supplierBill.findFirst({
    where: { id: billId, companyId },
    include: { supplier: { select: { id: true, name: true } } },
  });
  if (!bill) throw new AppError("NOT_FOUND", "Supplier bill not found.");
  assertAllowed(canPayBill(bill));
  const amount = money(input.amount);
  if (amount.gt(bill.dueAmount)) {
    throw new AppError("VALIDATION", `Only ${bill.dueAmount.toFixed(2)} is due on ${bill.number}.`);
  }
  const paymentDate = input.paymentDate ?? new Date();
  const creditAccount = await cashAccountFor(tx, companyId, input.method, input.accountId);
  const acc = await ensureControlAccounts(companyId, tx);
  const payment = await tx.payment.create({
    data: {
      companyId,
      number: await nextDocumentNumber(tx, companyId, "PAYMENT_VOUCHER"),
      direction: "PAID",
      method: input.method,
      partyId: bill.supplierId,
      amount,
      paymentDate,
      accountId: creditAccount,
      supplierBillId: bill.id,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    },
  });
  const entry = await postJournalEntry(tx, {
    companyId,
    date: paymentDate,
    description: `Payment ${payment.number} to ${bill.supplier.name} — ${bill.number}`,
    sourceType: "PAYMENT",
    sourceId: payment.id,
    postedById: ctx.user.id,
    lines: [
      { accountId: acc.PAYABLE, partyId: bill.supplierId, debit: amount, memo: bill.number },
      { accountId: creditAccount, credit: amount, memo: input.reference ?? undefined },
    ],
  });
  await tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });
  const paid = bill.paidAmount.plus(amount);
  const due = bill.totalAmount.minus(paid);
  await tx.supplierBill.update({
    where: { id: bill.id },
    data: { paidAmount: paid, dueAmount: due, status: due.lte(0) ? "PAID" : "PARTIALLY_PAID" },
  });
  await settleSupplierBills(tx, companyId, bill.supplierId);
  await recordPartyActivity(bill.supplierId, paymentDate, tx);
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "Payment",
      entityId: payment.id,
      summary: `Paid ${amount.toFixed(2)} (${input.method}) ${payment.number} to ${bill.supplier.name} — ${bill.number}`,
    },
    tx,
  );
  return payment;
}

/** Accounts pays a Due bill, in full or in part. */
export async function payBill(
  ctx: CompanyContext,
  billId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = payBillSchema.parse(raw);
  assertCanPayOut(ctx);
  await prisma.$transaction(
    (tx) =>
      payBillTx(
        tx,
        ctx,
        billId,
        {
          ...input,
          paymentDate: input.paymentDate
            ? toInstant(input.paymentDate, ctx.company.timezone)
            : undefined,
        },
        meta,
      ),
    TX_OPTIONS,
  );
  return getBill(ctx, billId);
}

/**
 * Voids a bill entered by mistake: its entry is reversed and anything already
 * paid on it stays on the supplier's ledger as an advance. Not possible once
 * the cost has moved into stock.
 */
/** Each project's share of a bill, with what the project still holds in work in progress. */
export function billShares(
  allocations: Array<{ projectId: string | null; amount: Prisma.Decimal }>,
  projects: Map<string, { code: string; status: ProductionStatus }>,
  costs: Map<string, { wip: Prisma.Decimal }>,
) {
  return [...projects].map(([id, project]) => ({
    project: { code: project.code, status: project.status, wip: costs.get(id)!.wip },
    amount: allocations.filter((a) => a.projectId === id).reduce((s, a) => s.plus(a.amount), ZERO),
  }));
}

export async function voidBill(
  ctx: CompanyContext,
  billId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = voidSchema.parse(raw);
  const companyId = ctx.company.id;
  await prisma.$transaction(async (tx) => {
    // The supplier's account before the bill (see payBillTx).
    const owner = await tx.supplierBill.findFirst({
      where: { id: billId, companyId },
      select: { supplierId: true },
    });
    if (owner) await lockSupplierAccount(tx, companyId, owner.supplierId);
    await lockRow(tx, "SupplierBill", billId);
    const bill = await tx.supplierBill.findFirst({
      where: { id: billId, companyId },
      include: {
        allocations: true,
        supplier: { select: { name: true } },
        _count: { select: { items: true } },
      },
    });
    if (!bill) throw new AppError("NOT_FOUND", "Supplier bill not found.");
    // A raw material purchase's goods are in the store: voiding has to take them back
    // out, from Raw materials.
    const state = { ...bill, itemCount: bill._count.items };
    assertAllowed(canVoidBill(state, []));
    const projectIds = [
      ...new Set(bill.allocations.flatMap((a) => (a.projectId ? [a.projectId] : []))),
    ];
    const projects = await lockOpenProjects(
      tx,
      companyId,
      projectIds,
      "its bills can no longer be voided",
    );
    const costs = await projectCostSummaries(tx, companyId, projectIds);
    assertAllowed(canVoidBill(state, billShares(bill.allocations, projects, costs)));
    if (bill.journalEntryId) {
      await reverseJournalEntry(tx, bill.journalEntryId, {
        description: `Void bill ${bill.number}: ${reason}`,
        postedById: ctx.user.id,
      });
    }
    await tx.payment.updateMany({
      where: { supplierBillId: bill.id },
      data: { supplierBillId: null, isAdvance: true },
    });
    await tx.supplierBill.update({
      where: { id: bill.id },
      data: { status: "VOID", paidAmount: 0, dueAmount: 0 },
    });
    // What was paid on it now settles the supplier's other open bills.
    await settleSupplierBills(tx, companyId, bill.supplierId);
    await refreshProjectCosts(tx, companyId, projectIds);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "SupplierBill",
        entityId: bill.id,
        summary: `Voided bill ${bill.number} (${bill.totalAmount.toFixed(2)}): ${reason}${
          bill.paidAmount.gt(0)
            ? `; ${bill.paidAmount.toFixed(2)} already paid stays as an advance to ${bill.supplier.name}`
            : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getBill(ctx, billId);
}

export async function getBill(ctx: CompanyContext, billId: string) {
  assertCanSeeProductionCosts(ctx);
  const bill = await ctx.db.supplierBill.findUnique({
    where: { id: billId },
    include: {
      supplier: { select: { id: true, code: true, name: true, phone: true } },
      allocations: {
        orderBy: { id: "asc" },
        include: {
          project: { select: { id: true, code: true, name: true, status: true } },
          expenseHead: { select: { id: true, name: true, category: true } },
        },
      },
      // Raw material purchases: the goods, the store they went into and the order.
      items: {
        orderBy: { id: "asc" },
        include: { rawMaterial: { select: { id: true, code: true, name: true, unit: true } } },
      },
      warehouse: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, number: true, status: true } },
      payments: {
        orderBy: [{ paymentDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          number: true,
          amount: true,
          method: true,
          paymentDate: true,
          reference: true,
          account: { select: { id: true, name: true } },
        },
      },
      attachment: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
    },
  });
  if (!bill) throw new AppError("NOT_FOUND", "Supplier bill not found.");
  return bill;
}

export async function listBills(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSeeProductionCosts(ctx);
  const q = listBillsSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.supplierBill.findMany({
    where: {
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.projectId ? { allocations: { some: { projectId: q.projectId } } } : {}),
      ...(start || end
        ? { billDate: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      allocations: {
        orderBy: { id: "asc" },
        select: { projectId: true, amount: true, project: { select: { code: true } } },
      },
      // Raw material lines (purchases into the store) and project shares.
      _count: { select: { items: true, allocations: true } },
    },
    orderBy: [{ billDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}

// =============================================================================
// Costs on one project
// =============================================================================

/**
 * Adds one cost to a project. With a supplier it becomes a one-line bill (so it
 * shows on the supplier's ledger); without one it is paid straight from cash
 * or bank: Dr Work in Progress, Cr Cash / Bank / Wallet.
 */
export async function addProjectCost(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = addProjectCostSchema.parse(raw);
  if (input.paymentType === "CASH_BANK") assertCanPayOut(ctx);
  const companyId = ctx.company.id;
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();

  if (input.supplierId) {
    const billInput: BillInput = {
      supplierId: input.supplierId,
      supplierRef: input.supplierRef,
      billDate: date,
      paymentType: input.paymentType,
      method: input.method,
      accountId: input.accountId,
      reference: input.reference,
      allocations: [
        {
          projectId,
          expenseHeadId: input.expenseHeadId,
          amount: input.amount,
          description: input.description,
        },
      ],
    };
    const prepared = await prepareBill(ctx, billInput);
    if (!input.allowDuplicate) {
      await assertNotDuplicate(ctx, {
        total: money(input.amount),
        date,
        supplier: prepared.supplier,
        supplierRef: input.supplierRef,
      });
    }
    await prisma.$transaction((tx) => createBillTx(tx, ctx, billInput, prepared, meta), TX_OPTIONS);
    return getProjectCostSheet(ctx, projectId);
  }

  const head = (await loadCostHeads(ctx, [input.expenseHeadId])).get(input.expenseHeadId)!;
  if (!input.allowDuplicate) {
    await assertNotDuplicate(ctx, {
      total: money(input.amount),
      date,
      projectId,
      headId: head.id,
    });
  }
  await prisma.$transaction(async (tx) => {
    const project = (
      await lockOpenProjects(tx, companyId, [projectId], "no more costs can be added")
    ).get(projectId)!;
    await paidCostTx(tx, ctx, meta, { ...input, date, head, project, amount: money(input.amount) });
  }, TX_OPTIONS);
  return getProjectCostSheet(ctx, projectId);
}

/**
 * A cost of a master batch (QC, travel...) by its Cost Setup: on one of its
 * styles, or split equally among its open styles (to the cent, the odd cents to
 * the first ones). Owed to a supplier, it is one bill split across the styles;
 * paid now from cash or bank (Accounts), one cost on each style. Either way
 * each style carries its share in its own cost.
 */
export async function addBatchCost(
  ctx: CompanyContext,
  batchId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = addBatchCostSchema.parse(raw);
  if (input.paymentType === "CASH_BANK") assertCanPayOut(ctx);
  const companyId = ctx.company.id;
  const batch = await ctx.db.productionBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      code: true,
      projects: { select: { id: true, code: true, status: true }, orderBy: { code: "asc" } },
    },
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  let styles: Array<{ id: string; code: string }>;
  if (input.split === "ONE") {
    const style = batch.projects.find((p) => p.id === input.projectId);
    if (!style) {
      throw new AppError("VALIDATION", "Choose one of the batch's styles.", {
        projectId: ["Not a style of this batch"],
      });
    }
    if (isProjectClosed(style)) {
      throw new AppError(
        "CONFLICT",
        `${style.code} is ${style.status.toLowerCase()}; no more costs can be added.`,
        { projectId: ["This style is closed"] },
      );
    }
    styles = [style];
  } else {
    styles = batch.projects.filter((p) => !isProjectClosed(p));
    if (styles.length === 0) {
      throw new AppError("CONFLICT", `${batch.code} has no open style to share the cost.`);
    }
  }
  const shares = splitEqually(input.amount, styles.length);
  if (shares.some((share) => share.lte(0))) {
    throw new AppError("VALIDATION", `Too little to split among ${styles.length} styles.`, {
      amount: [`At least ${(styles.length / 100).toFixed(2)}`],
    });
  }
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  const head = (await loadCostHeads(ctx, [input.expenseHeadId])).get(input.expenseHeadId)!;
  const total = money(input.amount);
  const splitNote =
    styles.length > 1 ? `${batch.code}, split equally among ${styles.length} styles` : null;
  const description = [input.description, splitNote].filter(Boolean).join(" · ") || undefined;
  const auditBatch = (tx: Tx) =>
    auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "ProductionBatch",
        entityId: batch.id,
        summary: `Cost Setup: ${total.toFixed(2)} ${head.name} ${
          styles.length > 1 ? `split equally among ${styles.length} styles` : "on one style"
        } of ${batch.code} (${styles.map((st, i) => `${st.code} ${shares[i]!.toFixed(2)}`).join(", ")})`,
      },
      tx,
    );

  if (input.supplierId) {
    const billInput: BillInput = {
      supplierId: input.supplierId,
      supplierRef: input.supplierRef,
      billDate: date,
      paymentType: input.paymentType,
      method: input.method,
      accountId: input.accountId,
      reference: input.reference,
      notes: splitNote ?? undefined,
      allocations: styles.map((st, i) => ({
        projectId: st.id,
        expenseHeadId: head.id,
        amount: shares[i]!.toNumber(),
        description: input.description,
      })),
    };
    const prepared = await prepareBill(ctx, billInput);
    if (!input.allowDuplicate) {
      await assertNotDuplicate(ctx, {
        total,
        date,
        supplier: prepared.supplier,
        supplierRef: input.supplierRef,
      });
    }
    await prisma.$transaction(async (tx) => {
      await createBillTx(tx, ctx, billInput, prepared, meta);
      await auditBatch(tx);
    }, TX_OPTIONS);
  } else {
    if (!input.allowDuplicate) {
      await assertNotDuplicate(ctx, {
        total: shares[0]!,
        date,
        projectId: styles[0]!.id,
        headId: head.id,
      });
    }
    await prisma.$transaction(async (tx) => {
      const locked = await lockOpenProjects(
        tx,
        companyId,
        styles.map((st) => st.id),
        "no more costs can be added",
      );
      for (const [i, st] of styles.entries()) {
        await paidCostTx(tx, ctx, meta, {
          ...input,
          description,
          date,
          head,
          project: locked.get(st.id)!,
          amount: shares[i]!,
        });
      }
      await auditBatch(tx);
    }, TX_OPTIONS);
  }
  return {
    batch: { id: batch.id, code: batch.code },
    total: total.toFixed(2),
    shares: styles.map((st, i) => ({ id: st.id, code: st.code, amount: shares[i]!.toFixed(2) })),
  };
}

/**
 * One cost paid now from cash, bank or wallet on a project locked open in this
 * transaction: Dr Work in Progress, Cr Cash / Bank / Wallet. Accounts only (the
 * caller checks).
 */
export async function paidCostTx(
  tx: Tx,
  ctx: CompanyContext,
  meta: RequestMeta | undefined,
  input: {
    project: { id: string; code: string };
    head: { id: string; name: string };
    amount: Prisma.Decimal;
    date: Date;
    method?: PaymentMethod;
    accountId?: string;
    reference?: string | null;
    description?: string | null;
  },
) {
  const companyId = ctx.company.id;
  const { project, head, amount, date } = input;
  const method = input.method ?? "CASH";
  const paidFrom = await cashAccountFor(tx, companyId, method, input.accountId);
  const acc = await ensureControlAccounts(companyId, tx);
  const expense = await tx.expense.create({
    data: {
      companyId,
      number: await nextDocumentNumber(tx, companyId, "EXPENSE_VOUCHER"),
      date,
      headId: head.id,
      amount,
      paymentType: "CASH_BANK",
      paidFromAccountId: paidFrom,
      projectId: project.id,
      description:
        [input.description, input.reference ? `Ref ${input.reference}` : null]
          .filter(Boolean)
          .join(" · ") || null,
    },
  });
  const entry = await postJournalEntry(tx, {
    companyId,
    date,
    description: `${expense.number} — ${head.name} for ${project.code}`,
    sourceType: "EXPENSE",
    sourceId: expense.id,
    postedById: ctx.user.id,
    lines: [
      { accountId: acc.WORK_IN_PROGRESS, debit: amount, memo: `${project.code} · ${head.name}` },
      { accountId: paidFrom, credit: amount, memo: input.reference ?? undefined },
    ],
  });
  await tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: entry.id } });
  await refreshProjectCosts(tx, companyId, [project.id]);
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "Expense",
      entityId: expense.id,
      summary: `${expense.number}: ${amount.toFixed(2)} ${head.name} for ${project.code}, paid (${method})`,
    },
    tx,
  );
  return expense;
}

/** Voids a cost paid from cash / bank (its entry is reversed). Accounts only. */
export async function voidProjectCost(
  ctx: CompanyContext,
  expenseId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = voidSchema.parse(raw);
  assertCanPayOut(ctx);
  const companyId = ctx.company.id;
  const expense = await ctx.db.expense.findUnique({ where: { id: expenseId } });
  if (!expense?.projectId) throw new AppError("NOT_FOUND", "Production cost not found.");
  const projectId = expense.projectId;
  await prisma.$transaction(async (tx) => {
    const project = (
      await lockOpenProjects(tx, companyId, [projectId], "its costs can no longer change")
    ).get(projectId)!;
    await assertClaimNotPaidBack(tx, expense);
    const { count } = await tx.expense.updateMany({
      where: { id: expense.id, companyId, voidedAt: null },
      data: { voidedAt: new Date(), voidReason: reason },
    });
    if (count === 0) throw new AppError("CONFLICT", `${expense.number} is already void.`);
    if ((await projectCostSummary(tx, companyId, projectId)).wip.lt(0)) {
      throw new AppError(
        "CONFLICT",
        `${project.code} has already moved this cost into stock, so it can no longer be voided.`,
      );
    }
    if (expense.journalEntryId) {
      await reverseJournalEntry(tx, expense.journalEntryId, {
        description: `Void ${expense.number}: ${reason}`,
        postedById: ctx.user.id,
      });
    }
    await refreshProjectCosts(tx, companyId, [projectId]);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Expense",
        entityId: expense.id,
        summary: `Voided ${expense.number} (${expense.amount.toFixed(2)}) on ${project.code}: ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getProjectCostSheet(ctx, projectId);
}

/**
 * Batch costing sheet: every cost on the project by expense head, what moved
 * into stock, what is still in work in progress, and the cost per piece.
 */
export async function getProjectCostSheet(ctx: CompanyContext, projectId: string) {
  assertCanSeeProductionCosts(ctx);
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      targetQuantity: true,
      producedQtyA: true,
      producedQtyB: true,
    },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  const allocations = await prisma.supplierBillAllocation.findMany({
    where: { projectId: project.id, bill: { companyId: ctx.company.id } },
    include: {
      bill: {
        select: {
          id: true,
          number: true,
          billDate: true,
          status: true,
          paymentType: true,
          supplierRef: true,
          supplier: { select: { id: true, code: true, name: true } },
        },
      },
      expenseHead: { select: { id: true, name: true, category: true } },
    },
  });
  const expenses = await ctx.db.expense.findMany({
    where: { projectId: project.id },
    include: {
      head: { select: { id: true, name: true, category: true } },
      paidFromAccount: { select: { id: true, name: true } },
      // Local material an employee bought and claimed back (HR staff claims).
      employee: { select: { id: true, name: true } },
    },
  });
  const summary = await projectCostSummary(prisma, ctx.company.id, project.id);
  // Raw materials issued from the store (and returned unused), at what they cost.
  const materials = await projectMaterialUsage(prisma, ctx.company.id, project.id);
  const materialNotes = await ctx.db.materialIssue.findMany({
    where: { projectId: project.id },
    include: { warehouse: { select: { id: true, name: true } } },
  });

  const byHead = new Map<
    string,
    { headId: string; name: string; category: ExpenseCategory; amount: Prisma.Decimal }
  >();
  const addToHead = (
    head: { id: string; name: string; category: ExpenseCategory },
    amount: Prisma.Decimal,
  ) => {
    const row = byHead.get(head.id) ?? {
      headId: head.id,
      name: head.name,
      category: head.category,
      amount: ZERO,
    };
    row.amount = row.amount.plus(amount);
    byHead.set(head.id, row);
  };
  for (const a of allocations) if (a.bill.status !== "VOID") addToHead(a.expenseHead, a.amount);
  for (const e of expenses) if (!e.voidedAt) addToHead(e.head, e.amount);

  const entries = [
    ...allocations.map((a) => ({
      kind: "BILL" as const,
      id: a.id,
      date: a.bill.billDate,
      number: a.bill.number,
      billId: a.bill.id,
      supplier: a.bill.supplier,
      supplierRef: a.bill.supplierRef,
      head: a.expenseHead,
      amount: a.amount,
      description: a.description,
      paymentType: a.bill.paymentType,
      billStatus: a.bill.status,
      isVoid: a.bill.status === "VOID",
    })),
    ...expenses.map((e) => ({
      kind: "DIRECT" as const,
      id: e.id,
      date: e.date,
      number: e.number,
      paidFrom: e.paidFromAccount,
      /** Bought by this employee and owed to them (a staff claim). */
      boughtBy: e.paymentType === "DUE" ? e.employee : null,
      head: e.head,
      amount: e.amount,
      description: e.description,
      paymentType: e.paymentType,
      isVoid: Boolean(e.voidedAt),
      voidReason: e.voidReason,
    })),
    ...materialNotes.map((n) => ({
      kind: n.kind === "ISSUE" ? ("MATERIAL_ISSUE" as const) : ("MATERIAL_RETURN" as const),
      id: n.id,
      date: n.date,
      number: n.number,
      warehouse: n.warehouse,
      receivedBy: n.receivedBy,
      /** A return takes cost back out of the project. */
      amount: n.kind === "ISSUE" ? n.totalValue : ZERO.minus(n.totalValue),
      description: n.note,
      isVoid: false,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number));

  const received = project.producedQtyA + project.producedQtyB;
  return {
    project,
    summary: {
      ...summary,
      piecesReceived: received,
      estimatedCostPerPiece: summary.totalCost.dividedBy(project.targetQuantity).toDecimalPlaces(2),
      actualCostPerPiece:
        received > 0 ? summary.inStock.dividedBy(received).toDecimalPlaces(2) : null,
    },
    byHead: [...byHead.values()].sort((a, b) => b.amount.comparedTo(a.amount)),
    /** Raw materials from the store, per material (issued less returned). */
    byMaterial: materials.filter((m) => !m.netQuantity.isZero() || !m.netValue.isZero()),
    entries,
  };
}
