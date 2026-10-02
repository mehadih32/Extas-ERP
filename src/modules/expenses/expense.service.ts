import type { Expense, ExpenseHead, Party, Prisma } from "@prisma/client";

import { dayRange, toInstant } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { money } from "@/modules/accounts/balances";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import {
  EXPENSE_CATEGORY_ACCOUNTS,
  ensureExpenseCategoryAccounts,
  type GeneralExpenseCategory,
} from "@/modules/accounts/chart";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { assertCanPayMoney, assertCanReceiveMoney } from "@/modules/accounts/money-guards";
import { settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  approveExpenseSchema,
  createExpenseSchema,
  expenseHeadSchema,
  type ExpenseStatus,
  GENERAL_CATEGORIES,
  listExpenseHeadsSchema,
  listExpensesSchema,
  rejectExpenseSchema,
  updateExpenseHeadSchema,
  updateExpenseSchema,
  voidExpenseSchema,
} from "@/modules/expenses/schemas";
import { assertPartyCanTransact, recordPartyActivity } from "@/modules/parties/party.service";

/*
 * General expenses (Quick Add: rent, utilities, marketing, conveyance...). Each
 * head posts to an expense account (its category's, or one chosen for it):
 *   Paid now            Dr Expense account   Cr Cash / Bank / Wallet   (Accounts)
 *   Owed to a supplier  Dr Expense account   Cr Payable (supplier)
 *   Claim               saved without an entry until Accounts approves it
 * The books stay with Accounts: an expense recorded by anyone else is a claim.
 * Accounts pays a cash claim back (choosing cash, bank or a wallet), puts a Due
 * claim on the supplier's account, or rejects it. Production costs are recorded
 * on production projects instead.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

const GENERAL = new Set<string>(GENERAL_CATEGORIES);

export const DEFAULT_EXPENSE_HEADS: ReadonlyArray<{
  name: string;
  category: GeneralExpenseCategory;
  requiresEmployee?: boolean;
  /** Posts to Finance Costs instead of the category's account. */
  financeCost?: boolean;
}> = [
  { name: "Office Rent", category: "RENT" },
  { name: "Electricity, Water & Gas", category: "UTILITIES" },
  { name: "Internet & Phone", category: "UTILITIES" },
  { name: "Salaries & Wages", category: "SALARY" },
  { name: "Marketing & Ads", category: "MARKETING" },
  { name: "Courier & Delivery", category: "COURIER" },
  { name: "Office Supplies", category: "OFFICE" },
  { name: "Repairs & Maintenance", category: "MAINTENANCE" },
  { name: "Conveyance", category: "CONVEYANCE", requiresEmployee: true },
  { name: "Food & Refreshments", category: "FOOD", requiresEmployee: true },
  { name: "Bank Charges", category: "OTHER", financeCost: true },
  { name: "Other Expenses", category: "OTHER" },
];

/** Gives a company the default expense heads (and their accounts) on first use. */
export async function ensureGeneralExpenseHeads(companyId: string, db: Db = prisma) {
  const existing = await db.expenseHead.count({ where: { companyId, isProductionCost: false } });
  if (existing > 0) return;
  const byCode = await ensureExpenseCategoryAccounts(companyId, db);
  const acc = await ensureControlAccounts(companyId, db);
  await db.expenseHead.createMany({
    data: DEFAULT_EXPENSE_HEADS.map((h) => ({
      companyId,
      name: h.name,
      category: h.category,
      requiresEmployee: h.requiresEmployee ?? false,
      isProductionCost: false,
      ledgerAccountId: h.financeCost
        ? acc.FINANCE_COST
        : byCode.get(EXPENSE_CATEGORY_ACCOUNTS[h.category].code)!,
    })),
    skipDuplicates: true,
  });
}

/** Where a head's expenses land in the books. */
async function headAccountId(db: Db, companyId: string, head: ExpenseHead): Promise<string> {
  if (head.ledgerAccountId) {
    const account = await db.ledgerAccount.findFirst({
      where: { id: head.ledgerAccountId, companyId },
    });
    if (account?.isActive) return account.id;
    throw new AppError(
      "VALIDATION",
      `The account for "${head.name}" is archived; choose another account for this head.`,
    );
  }
  if (!GENERAL.has(head.category)) {
    throw new AppError("VALIDATION", "Production costs are recorded on production projects.");
  }
  const byCode = await ensureExpenseCategoryAccounts(companyId, db);
  return byCode.get(EXPENSE_CATEGORY_ACCOUNTS[head.category as GeneralExpenseCategory].code)!;
}

/** Status from the record: an entry means it is in the books; voidedAt means it was undone. */
export function expenseStatus(e: Pick<Expense, "journalEntryId" | "voidedAt">): ExpenseStatus {
  if (e.voidedAt) return e.journalEntryId ? "VOID" : "REJECTED";
  return e.journalEntryId ? "POSTED" : "PENDING";
}

function statusWhere(status: ExpenseStatus): Prisma.ExpenseWhereInput {
  switch (status) {
    case "PENDING":
      return { journalEntryId: null, voidedAt: null };
    case "POSTED":
      return { journalEntryId: { not: null }, voidedAt: null };
    case "REJECTED":
      return { journalEntryId: null, voidedAt: { not: null } };
    case "VOID":
      return { journalEntryId: { not: null }, voidedAt: { not: null } };
  }
}

/** Expense heads decide where money lands in the books. */
function assertCanManageHeads(ctx: CompanyContext) {
  if (!ctx.can("expenses.manage") && !ctx.can("accounts.manage")) {
    throw new AppError("FORBIDDEN", "Only Accounts can change expense heads.");
  }
}

/** Accounts and expense managers see every expense; others see the ones they recorded. */
function seesAll(ctx: CompanyContext) {
  return (
    ctx.can("expenses.manage") || ctx.can("accounts.view") || ctx.can("accounts.payments.record")
  );
}

// =============================================================================
// Heads
// =============================================================================

const headInclude = {
  ledgerAccount: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ExpenseHeadInclude;

export async function listExpenseHeads(ctx: CompanyContext, raw: unknown = {}) {
  const q = listExpenseHeadsSchema.parse(raw);
  await ensureGeneralExpenseHeads(ctx.company.id);
  return ctx.db.expenseHead.findMany({
    where: { isProductionCost: false, ...(q.includeInactive ? {} : { isActive: true }) },
    include: headInclude,
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
  if (clash)
    throw new AppError("CONFLICT", `An expense head called "${clash.name}" already exists.`);
}

/** Expense heads can post to any active expense account except cost of goods sold. */
async function assertExpenseAccount(ctx: CompanyContext, accountId: string) {
  const account = await ctx.db.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!account || account.type !== "EXPENSE" || account.subType === "COGS" || !account.isActive) {
    throw new AppError("VALIDATION", "Choose an active expense account.", {
      ledgerAccountId: ["Choose an active expense account."],
    });
  }
}

export async function createExpenseHead(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHeads(ctx);
  const input = expenseHeadSchema.parse(raw);
  await ensureGeneralExpenseHeads(ctx.company.id);
  await assertHeadNameFree(ctx, input.name);
  if (input.ledgerAccountId) await assertExpenseAccount(ctx, input.ledgerAccountId);
  const head = await ctx.db.expenseHead.create({
    data: {
      companyId: ctx.company.id,
      name: input.name,
      category: input.category,
      requiresEmployee:
        input.requiresEmployee ?? (input.category === "CONVEYANCE" || input.category === "FOOD"),
      ledgerAccountId: input.ledgerAccountId ?? null,
      isProductionCost: false,
    },
    include: headInclude,
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "ExpenseHead",
    entityId: head.id,
    summary: `Added expense head "${head.name}" (${head.category})`,
  });
  return head;
}

export async function updateExpenseHead(
  ctx: CompanyContext,
  headId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHeads(ctx);
  const input = updateExpenseHeadSchema.parse(raw);
  const head = await ctx.db.expenseHead.findUnique({ where: { id: headId } });
  if (!head || head.isProductionCost) throw new AppError("NOT_FOUND", "Expense head not found.");
  if (input.name && input.name !== head.name) await assertHeadNameFree(ctx, input.name, head.id);
  if (input.ledgerAccountId) await assertExpenseAccount(ctx, input.ledgerAccountId);
  const updated = await ctx.db.expenseHead.update({
    where: { id: head.id },
    data: {
      name: input.name,
      category: input.category,
      requiresEmployee: input.requiresEmployee,
      ledgerAccountId: input.ledgerAccountId,
      isActive: input.isActive,
    },
    include: headInclude,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "ExpenseHead",
    entityId: head.id,
    summary: `Updated expense head "${updated.name}": ${Object.keys(input).join(", ")}`,
  });
  return updated;
}

// =============================================================================
// Expenses
// =============================================================================

const expenseInclude = {
  head: { select: { id: true, name: true, category: true } },
  employee: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, name: true } },
  paidFromAccount: { select: { id: true, code: true, name: true } },
  receiptFile: { select: { id: true, fileName: true, mimeType: true } },
  createdBy: { select: { id: true, name: true } },
  journalEntry: { select: { id: true, number: true, date: true, isReversed: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

function presentExpense(e: ExpenseRow) {
  return {
    id: e.id,
    number: e.number,
    date: e.date,
    status: expenseStatus(e),
    head: e.head,
    amount: e.amount.toFixed(2),
    paymentType: e.paymentType,
    paidFrom: e.paidFromAccount,
    supplier: e.supplier,
    employee: e.employee,
    purpose: e.purpose,
    fromLocation: e.fromLocation,
    toLocation: e.toLocation,
    description: e.description,
    receiptFile: e.receiptFile,
    createdBy: e.createdBy,
    journalEntry: e.journalEntry,
    voidedAt: e.voidedAt,
    voidReason: e.voidReason,
    createdAt: e.createdAt,
  };
}

async function loadExpense(ctx: CompanyContext, expenseId: string) {
  const expense = await ctx.db.expense.findUnique({
    where: { id: expenseId },
    include: expenseInclude,
  });
  // Production costs belong to their project.
  if (!expense || expense.projectId) throw new AppError("NOT_FOUND", "Expense not found.");
  if (!seesAll(ctx) && expense.createdById !== ctx.user.id) {
    throw new AppError("NOT_FOUND", "Expense not found.");
  }
  return expense;
}

export async function getExpense(ctx: CompanyContext, expenseId: string) {
  return presentExpense(await loadExpense(ctx, expenseId));
}

export async function listExpenses(ctx: CompanyContext, raw: unknown = {}) {
  const q = listExpensesSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const where: Prisma.ExpenseWhereInput = {
    AND: [
      { projectId: null },
      !seesAll(ctx) || q.mine ? { createdById: ctx.user.id } : {},
      q.status ? statusWhere(q.status) : {},
      q.headId ? { headId: q.headId } : {},
      q.category ? { head: { category: q.category } } : {},
      q.employeeId ? { employeeId: q.employeeId } : {},
      q.supplierId ? { supplierId: q.supplierId } : {},
      start || end
        ? { date: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {},
      q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: "insensitive" } },
              { description: { contains: q.search, mode: "insensitive" } },
              { purpose: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  const rows = await ctx.db.expense.findMany({
    where,
    include: expenseInclude,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items: items.map(presentExpense), nextCursor: hasMore ? items.at(-1)?.id : undefined };
}

/** Head, employee and receipt checks shared by create and update. */
async function checkDetails(
  ctx: CompanyContext,
  head: ExpenseHead,
  details: { employeeId?: string | null; purpose?: string | null; receiptFileId?: string | null },
  options: { newHead: boolean } = { newHead: true },
) {
  if (head.isProductionCost) {
    throw new AppError("VALIDATION", "Production costs are recorded on production projects.");
  }
  if (options.newHead && !head.isActive) {
    throw new AppError("VALIDATION", `"${head.name}" is archived.`);
  }
  if (head.requiresEmployee && (!details.employeeId || !details.purpose)) {
    throw new AppError("VALIDATION", `${head.name} needs the employee and the purpose.`, {
      ...(details.employeeId ? {} : { employeeId: ["Choose the employee."] }),
      ...(details.purpose ? {} : { purpose: ["Say what it was for."] }),
    });
  }
  if (details.employeeId) {
    const employee = await ctx.db.employee.findUnique({ where: { id: details.employeeId } });
    if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  }
  if (details.receiptFileId) {
    const file = await ctx.db.fileAsset.findUnique({ where: { id: details.receiptFileId } });
    if (!file) throw new AppError("NOT_FOUND", "Receipt file not found.");
  }
}

async function loadHead(ctx: CompanyContext, headId: string) {
  const head = await ctx.db.expenseHead.findUnique({ where: { id: headId } });
  if (!head) throw new AppError("NOT_FOUND", "Expense head not found.");
  return head;
}

function entryDescription(expense: Expense, head: ExpenseHead, extra?: string) {
  return [`${expense.number} — ${head.name}`, expense.purpose, extra].filter(Boolean).join(" · ");
}

/** Pays an expense from cash / bank / wallet: Dr expense account, Cr the money account. */
async function postPaidTx(
  tx: Tx,
  ctx: CompanyContext,
  expense: Expense,
  head: ExpenseHead,
  pay: { paidFrom: string; date: Date; reference?: string | null; extra?: string },
) {
  const expenseAccount = await headAccountId(tx, ctx.company.id, head);
  return postJournalEntry(tx, {
    companyId: ctx.company.id,
    date: pay.date,
    description: entryDescription(expense, head, pay.extra),
    sourceType: "EXPENSE",
    sourceId: expense.id,
    postedById: ctx.user.id,
    lines: [
      { accountId: expenseAccount, debit: expense.amount, memo: head.name },
      { accountId: pay.paidFrom, credit: expense.amount, memo: pay.reference ?? undefined },
    ],
  });
}

/** Puts an expense on a supplier's account: Dr expense account, Cr Payable (supplier). */
async function postDueTx(
  tx: Tx,
  ctx: CompanyContext,
  expense: Expense,
  head: ExpenseHead,
  supplier: Pick<Party, "id" | "name">,
  reference?: string | null,
) {
  const companyId = ctx.company.id;
  const acc = await ensureControlAccounts(companyId, tx);
  const entry = await postJournalEntry(tx, {
    companyId,
    date: expense.date,
    description: entryDescription(expense, head, `due to ${supplier.name}`),
    sourceType: "EXPENSE",
    sourceId: expense.id,
    postedById: ctx.user.id,
    lines: [
      {
        accountId: await headAccountId(tx, companyId, head),
        debit: expense.amount,
        memo: head.name,
      },
      {
        accountId: acc.PAYABLE,
        partyId: supplier.id,
        credit: expense.amount,
        memo: reference ?? expense.number,
      },
    ],
  });
  // An advance already paid to the supplier settles it, oldest dues first.
  await settleSupplierBills(tx, companyId, supplier.id);
  await recordPartyActivity(supplier.id, expense.date, tx);
  return entry;
}

/** Accounts post expenses straight to the books; anyone else's wait as claims. */
function postsNow(ctx: CompanyContext, paymentType: "CASH_BANK" | "DUE") {
  if (ctx.can("accounts.payments.record")) return true;
  // A Due expense moves no money: expense managers may put it on the supplier's account.
  return paymentType === "DUE" && ctx.can("expenses.manage");
}

/**
 * Records an expense. Accounts' expenses go into the books straight away (paid,
 * or owed to the supplier); anyone else's become claims for Accounts to approve.
 */
export async function createExpense(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  if (!ctx.can("expenses.create")) {
    throw new AppError("FORBIDDEN", "You do not have permission to record expenses.");
  }
  const input = createExpenseSchema.parse(raw);
  const head = await loadHead(ctx, input.headId);
  await checkDetails(ctx, head, input);
  const supplier =
    input.paymentType === "DUE"
      ? await assertPartyCanTransact(ctx, input.supplierId!, "PURCHASE")
      : null;
  const companyId = ctx.company.id;
  const amount = money(input.amount);
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  const inBooks = postsNow(ctx, input.paymentType);

  const expenseId = await prisma.$transaction(async (tx) => {
    const paidFrom =
      inBooks && input.paymentType === "CASH_BANK"
        ? await cashAccountFor(tx, companyId, input.method, input.accountId)
        : null;
    const expense = await tx.expense.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "EXPENSE_VOUCHER"),
        date,
        headId: head.id,
        amount,
        paymentType: input.paymentType,
        paidFromAccountId: paidFrom,
        supplierId: supplier?.id ?? null,
        employeeId: input.employeeId ?? null,
        purpose: input.purpose ?? null,
        fromLocation: input.fromLocation ?? null,
        toLocation: input.toLocation ?? null,
        description: input.description ?? null,
        receiptFileId: input.receiptFileId ?? null,
        createdById: ctx.user.id,
      },
    });
    let entryNumber: string | null = null;
    if (paidFrom) {
      const entry = await postPaidTx(tx, ctx, expense, head, {
        paidFrom,
        date,
        reference: input.reference,
      });
      await tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: entry.id } });
      entryNumber = entry.number;
    } else if (inBooks && supplier) {
      const entry = await postDueTx(tx, ctx, expense, head, supplier, input.reference);
      await tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: entry.id } });
      entryNumber = entry.number;
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Expense",
        entityId: expense.id,
        summary: `${expense.number}: ${amount.toFixed(2)} ${head.name} — ${
          paidFrom
            ? `paid (${input.method}), ${entryNumber}`
            : entryNumber && supplier
              ? `due to ${supplier.name}, ${entryNumber}`
              : `claim waiting for Accounts${supplier ? ` (due to ${supplier.name})` : ""}`
        }`,
      },
      tx,
    );
    return expense.id;
  }, TX_OPTIONS);
  return getExpense(ctx, expenseId);
}

/** Locks a general expense and re-reads it inside the transaction. */
async function lockExpense(tx: Tx, ctx: CompanyContext, expenseId: string) {
  await lockRow(tx, "Expense", expenseId);
  const expense = await tx.expense.findFirst({
    where: { id: expenseId, companyId: ctx.company.id, projectId: null },
    include: { head: true, createdBy: { select: { name: true } } },
  });
  if (!expense) throw new AppError("NOT_FOUND", "Expense not found.");
  return expense;
}

/** Edits details; amount, head and date only change while it is still a claim. */
export async function updateExpense(
  ctx: CompanyContext,
  expenseId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateExpenseSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const expense = await lockExpense(tx, ctx, expenseId);
    const status = expenseStatus(expense);
    const own = expense.createdById === ctx.user.id;
    if (!ctx.can("expenses.manage") && !(own && status === "PENDING")) {
      throw new AppError("FORBIDDEN", "You can only change your own claims while they wait.");
    }
    if (status === "REJECTED" || status === "VOID") {
      throw new AppError("CONFLICT", `${expense.number} is ${status.toLowerCase()}.`);
    }
    const changesMoney =
      input.headId !== undefined || input.amount !== undefined || input.date !== undefined;
    if (status === "POSTED" && changesMoney) {
      throw new AppError(
        "CONFLICT",
        `${expense.number} is in the books; void it and record it again to change the amount, head or date.`,
      );
    }
    const head = input.headId ? await loadHead(ctx, input.headId) : expense.head;
    await checkDetails(
      ctx,
      head,
      {
        employeeId: input.employeeId !== undefined ? input.employeeId : expense.employeeId,
        purpose: input.purpose !== undefined ? input.purpose : expense.purpose,
        receiptFileId: input.receiptFileId,
      },
      { newHead: input.headId !== undefined && input.headId !== expense.headId },
    );
    await tx.expense.update({
      where: { id: expense.id },
      data: {
        headId: input.headId,
        amount: input.amount !== undefined ? money(input.amount) : undefined,
        date: input.date ? toInstant(input.date, ctx.company.timezone) : undefined,
        employeeId: input.employeeId,
        purpose: input.purpose,
        fromLocation: input.fromLocation,
        toLocation: input.toLocation,
        description: input.description,
        receiptFileId: input.receiptFileId,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Expense",
        entityId: expense.id,
        summary: `Updated ${expense.number}: ${Object.keys(input).join(", ")}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getExpense(ctx, expenseId);
}

/**
 * Accounts approves a claim: a cash claim is paid back from cash, bank or a
 * wallet; a Due claim goes onto the supplier's account (paid with them later).
 */
export async function approveExpense(
  ctx: CompanyContext,
  expenseId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanPayMoney(ctx, "Only Accounts can approve expense claims.");
  const input = approveExpenseSchema.parse(raw);
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  await prisma.$transaction(async (tx) => {
    const expense = await lockExpense(tx, ctx, expenseId);
    if (expenseStatus(expense) !== "PENDING") {
      throw new AppError("CONFLICT", `${expense.number} is not a waiting claim.`);
    }
    const claimant = expense.createdBy?.name;
    let summary: string;
    if (expense.paymentType === "DUE") {
      const supplier = await assertPartyCanTransact(ctx, expense.supplierId!, "PURCHASE");
      const entry = await postDueTx(tx, ctx, expense, expense.head, supplier, input.reference);
      await tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: entry.id } });
      summary = `Approved claim ${expense.number} (${expense.amount.toFixed(2)} ${expense.head.name}${
        claimant ? `, ${claimant}` : ""
      }): due to ${supplier.name}, ${entry.number}`;
    } else {
      const paidFrom = await cashAccountFor(tx, ctx.company.id, input.method, input.accountId);
      const entry = await postPaidTx(tx, ctx, expense, expense.head, {
        paidFrom,
        date,
        reference: input.reference,
        extra: claimant ? `claim by ${claimant}` : undefined,
      });
      await tx.expense.update({
        where: { id: expense.id },
        data: { paidFromAccountId: paidFrom, journalEntryId: entry.id },
      });
      summary = `Paid claim ${expense.number} (${expense.amount.toFixed(2)} ${expense.head.name}${
        claimant ? `, ${claimant}` : ""
      }) by ${input.method}, ${entry.number}`;
    }
    await auditInCompany(
      ctx,
      meta,
      { action: "STATUS_CHANGE", entityType: "Expense", entityId: expense.id, summary },
      tx,
    );
  }, TX_OPTIONS);
  return getExpense(ctx, expenseId);
}

/** Turns a claim down (Accounts, expense managers) or withdraws your own. */
export async function rejectExpense(
  ctx: CompanyContext,
  expenseId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = rejectExpenseSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const expense = await lockExpense(tx, ctx, expenseId);
    const own = expense.createdById === ctx.user.id;
    if (!own && !ctx.can("accounts.payments.record") && !ctx.can("expenses.manage")) {
      throw new AppError("FORBIDDEN", "Only Accounts can turn down someone else's claim.");
    }
    if (expenseStatus(expense) !== "PENDING") {
      throw new AppError("CONFLICT", `${expense.number} is not a waiting claim.`);
    }
    await tx.expense.update({
      where: { id: expense.id },
      data: { voidedAt: new Date(), voidReason: reason },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Expense",
        entityId: expense.id,
        summary: `${own ? "Withdrew" : "Rejected"} claim ${expense.number} (${expense.amount.toFixed(2)}): ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getExpense(ctx, expenseId);
}

/** Voids an expense in the books: its entry is reversed and the record stays. */
export async function voidExpense(
  ctx: CompanyContext,
  expenseId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  if (!ctx.can("expenses.manage")) {
    throw new AppError("FORBIDDEN", "Only Accounts can void expenses.");
  }
  const { reason } = voidExpenseSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const expense = await lockExpense(tx, ctx, expenseId);
    const status = expenseStatus(expense);
    if (status === "PENDING") {
      throw new AppError("CONFLICT", `${expense.number} is a claim; reject it instead.`);
    }
    if (status !== "POSTED") {
      throw new AppError("CONFLICT", `${expense.number} is already ${status.toLowerCase()}.`);
    }
    // Undoing a cash payment is Accounts' call: the money goes back into the account.
    if (expense.paymentType === "CASH_BANK") {
      assertCanPayMoney(ctx);
      assertCanReceiveMoney(ctx);
    }
    await reverseJournalEntry(tx, expense.journalEntryId!, {
      description: `Void ${expense.number}: ${reason}`,
      postedById: ctx.user.id,
    });
    if (expense.paymentType === "DUE" && expense.supplierId) {
      await settleSupplierBills(tx, ctx.company.id, expense.supplierId);
    }
    await tx.expense.update({
      where: { id: expense.id },
      data: { voidedAt: new Date(), voidReason: reason },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Expense",
        entityId: expense.id,
        summary: `Voided ${expense.number} (${expense.amount.toFixed(2)} ${expense.head.name}): ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getExpense(ctx, expenseId);
}
