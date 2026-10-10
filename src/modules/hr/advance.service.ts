import { type AdvanceSettlementKind, Prisma, type SalaryAdvance } from "@prisma/client";

import { dateColumn, dateOnly, localDay, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow, lockRows } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { money, ZERO } from "@/modules/accounts/balances";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import {
  assertCanManageAccounts,
  assertCanPayMoney,
  assertCanReceiveMoney,
} from "@/modules/accounts/money-guards";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { requireLinkedEmployee } from "@/modules/hr/access";
import { employedOn } from "@/modules/hr/month-data";
import type { RecoverableAdvance } from "@/modules/hr/payroll-calc";
import {
  canChangeAdvance,
  canTakeAdvanceBack,
  canUndoReturn,
  canVoidAdvance,
  isCashReturn,
} from "@/modules/hr/rules";
import {
  advanceReturnSchema,
  giveAdvanceSchema,
  listAdvancesSchema,
  updateAdvanceSchema,
  voidSchema,
} from "@/modules/hr/schemas";

/*
 * Salary advances: cash handed to an employee before payday (or for trips).
 *   Given             Dr Advances to Employees (employee)   Cr Cash / Bank / Wallet
 *   Owed at go-live   Dr Advances to Employees (employee)   Cr Opening Balance Equity
 *   Returned in cash  Dr Cash / Bank / Wallet                Cr Advances to Employees
 *   From salary       the month's payroll entry credits Advances (payroll.service)
 *   By an expense     a paid conveyance / food expense credits Advances instead of
 *                     cash (expense.service)
 * The oldest advances are settled first. Each advance's `outstanding` equals its
 * share of the Advances to Employees ledger (the books check compares them).
 * Paying out and taking back money are Accounts' (money-guards).
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

const advanceInclude = {
  employee: { select: { id: true, code: true, name: true } },
  paidFromAccount: { select: { id: true, code: true, name: true } },
  journalEntry: { select: { id: true, number: true, isReversed: true } },
  createdBy: { select: { id: true, name: true } },
  settlements: {
    orderBy: [{ settledAt: "asc" }, { id: "asc" }],
    include: {
      expense: { select: { id: true, number: true } },
      payrollItem: {
        select: { id: true, run: { select: { id: true, year: true, month: true } } },
      },
      journalEntry: { select: { id: true, number: true } },
    },
  },
} satisfies Prisma.SalaryAdvanceInclude;

type AdvanceRow = Prisma.SalaryAdvanceGetPayload<{ include: typeof advanceInclude }>;

function presentAdvance(a: AdvanceRow, timeZone: string) {
  return {
    id: a.id,
    number: a.number,
    employee: a.employee,
    amount: a.amount.toFixed(2),
    outstanding: a.outstanding.toFixed(2),
    recovered: a.amount.minus(a.outstanding).toFixed(2),
    givenAt: a.givenAt,
    givenOn: localDay(a.givenAt, timeZone),
    method: a.method,
    paidFrom: a.paidFromAccount,
    reference: a.reference,
    purpose: a.purpose,
    installmentAmount: a.installmentAmount?.toFixed(2) ?? null,
    /** First payroll month it is recovered in. */
    recoverFrom: (a.recoverFrom ? dateOnly(a.recoverFrom) : localDay(a.givenAt, timeZone)).slice(
      0,
      7,
    ),
    isOpening: a.isOpening,
    status: a.status,
    journalEntry: a.journalEntry,
    createdBy: a.createdBy,
    voidedAt: a.voidedAt,
    voidReason: a.voidReason,
    createdAt: a.createdAt,
    settlements: a.settlements.map((s) => ({
      id: s.id,
      kind: s.kind,
      amount: s.amount.toFixed(2),
      settledAt: s.settledAt,
      note: s.note,
      reversedAt: s.reversedAt,
      expense: s.expense,
      payroll: s.payrollItem
        ? {
            itemId: s.payrollItem.id,
            runId: s.payrollItem.run.id,
            month: `${s.payrollItem.run.year}-${String(s.payrollItem.run.month).padStart(2, "0")}`,
          }
        : null,
      journalEntry: s.journalEntry,
    })),
  };
}

/** The form payroll's recovery maths uses (payroll-calc.ts). */
export function recoverable(a: SalaryAdvance, timeZone: string): RecoverableAdvance {
  const givenDay = localDay(a.givenAt, timeZone);
  return {
    id: a.id,
    givenDay,
    recoverFromMonth: (a.recoverFrom ? dateOnly(a.recoverFrom) : givenDay).slice(0, 7),
    outstanding: a.outstanding,
    installment: a.installmentAmount,
  };
}

// =============================================================================
// Settling advances (shared with expenses and payroll)
// =============================================================================

/** Locks the open advances of these employees; returns them oldest first. */
export async function lockOpenAdvances(tx: Tx, companyId: string, employeeIds: string[]) {
  if (employeeIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "SalaryAdvance"
    WHERE "companyId" = ${companyId} AND "employeeId" IN (${Prisma.join(employeeIds)})
      AND status = 'OPEN'
    ORDER BY id
    FOR UPDATE`;
  if (rows.length === 0) return [];
  return tx.salaryAdvance.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    orderBy: [{ givenAt: "asc" }, { id: "asc" }],
  });
}

/** Records part of an advance as settled and lowers what is owed. */
export async function applySettlementTx(
  tx: Tx,
  advanceId: string,
  amount: Prisma.Decimal,
  data: {
    kind: AdvanceSettlementKind;
    settledAt: Date;
    expenseId?: string;
    payrollItemId?: string;
    journalEntryId?: string;
    note?: string | null;
  },
) {
  await tx.advanceSettlement.create({ data: { advanceId, amount, ...data } });
  const updated = await tx.salaryAdvance.update({
    where: { id: advanceId },
    data: { outstanding: { decrement: amount } },
  });
  if (updated.outstanding.isNegative()) {
    throw new AppError("CONFLICT", `${updated.number} would be settled for more than is owed.`);
  }
  if (updated.outstanding.isZero()) {
    await tx.salaryAdvance.update({ where: { id: advanceId }, data: { status: "SETTLED" } });
  }
}

/**
 * Settles a paid conveyance / food expense against the employee's open
 * advances, oldest first. Returns how much the advances covered (the rest is
 * paid in cash).
 */
export async function settleAdvancesForExpenseTx(
  tx: Tx,
  companyId: string,
  employeeId: string,
  amount: Prisma.Decimal,
  options: { expenseId: string; at: Date },
): Promise<Prisma.Decimal> {
  const open = await lockOpenAdvances(tx, companyId, [employeeId]);
  let left = amount;
  let covered = ZERO;
  for (const a of open) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(a.outstanding, left);
    if (take.lte(0)) continue;
    await applySettlementTx(tx, a.id, take, {
      kind: "EXPENSE",
      expenseId: options.expenseId,
      settledAt: options.at,
    });
    left = left.minus(take);
    covered = covered.plus(take);
  }
  return covered;
}

/**
 * Undoes the live settlements of a voided expense or a reopened payroll: the
 * advances are owed again. Returns the total put back.
 */
export async function reverseSettlementsTx(
  tx: Tx,
  companyId: string,
  source: { expenseId: string } | { payrollItemIds: string[] },
  at: Date = new Date(),
): Promise<Prisma.Decimal> {
  const settlements = await tx.advanceSettlement.findMany({
    where: {
      reversedAt: null,
      advance: { companyId },
      ...("expenseId" in source
        ? { expenseId: source.expenseId }
        : { payrollItemId: { in: source.payrollItemIds } }),
    },
  });
  if (settlements.length === 0) return ZERO;
  await lockRows(
    tx,
    "SalaryAdvance",
    settlements.map((s) => s.advanceId),
  );
  let total = ZERO;
  for (const s of settlements) {
    await tx.advanceSettlement.update({ where: { id: s.id }, data: { reversedAt: at } });
    await tx.salaryAdvance.update({
      where: { id: s.advanceId },
      data: { outstanding: { increment: s.amount }, status: "OPEN" },
    });
    total = total.plus(s.amount);
  }
  return total;
}

// =============================================================================
// Register
// =============================================================================

export async function listAdvances(ctx: CompanyContext, raw: unknown = {}) {
  const q = listAdvancesSchema.parse(raw);
  const take = q.take ?? 50;
  const rows = await ctx.db.salaryAdvance.findMany({
    where: {
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    include: advanceInclude,
    orderBy: [{ givenAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  const open = await ctx.db.salaryAdvance.aggregate({
    where: { status: "OPEN", ...(q.employeeId ? { employeeId: q.employeeId } : {}) },
    _sum: { outstanding: true },
    _count: { _all: true },
  });
  return {
    /** Everything still owed on open advances (all pages). */
    outstanding: { count: open._count._all, amount: (open._sum.outstanding ?? ZERO).toFixed(2) },
    items: items.map((a) => presentAdvance(a, ctx.company.timezone)),
    nextCursor: hasMore ? items.at(-1)?.id : undefined,
  };
}

export async function getAdvance(ctx: CompanyContext, advanceId: string) {
  const advance = await ctx.db.salaryAdvance.findUnique({
    where: { id: advanceId },
    include: advanceInclude,
  });
  if (!advance) throw new AppError("NOT_FOUND", "Advance not found.");
  return presentAdvance(advance, ctx.company.timezone);
}

/** Accounts hands an employee an advance (or records one owed from before the ERP). */
export async function giveAdvance(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = giveAdvanceSchema.parse(raw);
  if (input.isOpening) {
    assertCanManageAccounts(ctx, "Only Accounts can bring advances forward.");
  } else {
    assertCanPayMoney(ctx, "Only Accounts can pay out advances.");
  }
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const employee = await ctx.db.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const date = input.date ? toInstant(input.date, tz) : new Date();
  const day = localDay(date, tz);
  if (!employedOn(employee, day)) {
    throw new AppError("VALIDATION", `${employee.name} was not employed on ${day}.`);
  }
  const amount = money(input.amount);
  if (input.installmentAmount && money(input.installmentAmount).gt(amount)) {
    throw new AppError("VALIDATION", "The installment is more than the advance.", {
      installmentAmount: ["Must not be more than the advance."],
    });
  }
  const recoverFrom =
    input.recoverFrom && input.recoverFrom > day.slice(0, 7) ? input.recoverFrom : null;

  const id = await prisma.$transaction(async (tx) => {
    const acc = await ensureControlAccounts(companyId, tx);
    const paidFrom = input.isOpening
      ? null
      : await cashAccountFor(tx, companyId, input.method, input.accountId);
    const advance = await tx.salaryAdvance.create({
      data: {
        companyId,
        employeeId: employee.id,
        number: await nextDocumentNumber(tx, companyId, "SALARY_ADVANCE", date),
        amount,
        outstanding: amount,
        givenAt: date,
        method: input.method,
        paidFromAccountId: paidFrom,
        reference: input.reference ?? null,
        purpose: input.purpose ?? null,
        installmentAmount: input.installmentAmount ? money(input.installmentAmount) : null,
        recoverFrom: recoverFrom ? dateColumn(`${recoverFrom}-01`) : null,
        isOpening: input.isOpening,
        createdById: ctx.user.id,
      },
    });
    const entry = await postJournalEntry(tx, {
      companyId,
      date,
      description: `${advance.number} — ${input.isOpening ? "advance brought forward for" : "advance to"} ${
        employee.name
      }${input.purpose ? ` · ${input.purpose}` : ""}`,
      sourceType: "SALARY_ADVANCE",
      sourceId: advance.id,
      postedById: ctx.user.id,
      lines: [
        {
          accountId: acc.EMPLOYEE_ADVANCES,
          employeeId: employee.id,
          debit: amount,
          memo: advance.number,
        },
        {
          accountId: paidFrom ?? acc.OPENING_EQUITY,
          credit: amount,
          memo: input.reference ?? undefined,
        },
      ],
    });
    await tx.salaryAdvance.update({
      where: { id: advance.id },
      data: { journalEntryId: entry.id },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "SalaryAdvance",
        entityId: advance.id,
        summary: `${advance.number}: ${input.isOpening ? "brought forward" : `paid (${input.method})`} ${amount.toFixed(
          2,
        )} advance to ${employee.name}${
          input.installmentAmount
            ? `, recovered ${money(input.installmentAmount).toFixed(2)} a month`
            : ""
        }, ${entry.number}`,
      },
      tx,
    );
    return advance.id;
  }, TX_OPTIONS);
  return getAdvance(ctx, id);
}

/** Changes how an open advance is recovered (installment, first month) or its purpose. */
export async function updateAdvance(
  ctx: CompanyContext,
  advanceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  if (!ctx.can("accounts.payments.record") && !ctx.can("hr.payroll")) {
    throw new AppError(
      "FORBIDDEN",
      "Only Accounts or payroll can change how advances are recovered.",
    );
  }
  const input = updateAdvanceSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "SalaryAdvance", advanceId);
    const advance = await tx.salaryAdvance.findFirst({
      where: { id: advanceId, companyId: ctx.company.id },
    });
    if (!advance) throw new AppError("NOT_FOUND", "Advance not found.");
    assertAllowed(canChangeAdvance(advance));
    if (input.installmentAmount && money(input.installmentAmount).gt(advance.amount)) {
      throw new AppError("VALIDATION", "The installment is more than the advance.");
    }
    await tx.salaryAdvance.update({
      where: { id: advance.id },
      data: {
        purpose: input.purpose,
        ...(input.installmentAmount !== undefined
          ? {
              installmentAmount:
                input.installmentAmount === null ? null : money(input.installmentAmount),
            }
          : {}),
        ...(input.recoverFrom !== undefined
          ? { recoverFrom: input.recoverFrom ? dateColumn(`${input.recoverFrom}-01`) : null }
          : {}),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "SalaryAdvance",
        entityId: advance.id,
        summary: `Updated ${advance.number}: ${Object.keys(input).join(", ")}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getAdvance(ctx, advanceId);
}

async function lockAdvance(tx: Tx, ctx: CompanyContext, advanceId: string) {
  await lockRow(tx, "SalaryAdvance", advanceId);
  const advance = await tx.salaryAdvance.findFirst({
    where: { id: advanceId, companyId: ctx.company.id },
    include: { employee: { select: { id: true, name: true } } },
  });
  if (!advance) throw new AppError("NOT_FOUND", "Advance not found.");
  return advance;
}

/** The employee gives back unspent money: Dr Cash / Bank, Cr Advances. */
export async function returnAdvance(
  ctx: CompanyContext,
  advanceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanReceiveMoney(ctx, "Only Accounts can take money back.");
  const input = advanceReturnSchema.parse(raw);
  const companyId = ctx.company.id;
  const amount = money(input.amount);
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  await prisma.$transaction(async (tx) => {
    const advance = await lockAdvance(tx, ctx, advanceId);
    assertAllowed(canTakeAdvanceBack(advance));
    if (amount.gt(advance.outstanding)) {
      throw new AppError(
        "VALIDATION",
        `Only ${advance.outstanding.toFixed(2)} is still owed on ${advance.number}.`,
      );
    }
    const acc = await ensureControlAccounts(companyId, tx);
    const receivedInto = await cashAccountFor(tx, companyId, input.method, input.accountId);
    const entry = await postJournalEntry(tx, {
      companyId,
      date,
      description: `${advance.number} — ${advance.employee.name} returned unspent advance${
        input.note ? ` · ${input.note}` : ""
      }`,
      sourceType: "SALARY_ADVANCE",
      sourceId: advance.id,
      postedById: ctx.user.id,
      lines: [
        { accountId: receivedInto, debit: amount, memo: input.reference ?? undefined },
        {
          accountId: acc.EMPLOYEE_ADVANCES,
          employeeId: advance.employeeId,
          credit: amount,
          memo: advance.number,
        },
      ],
    });
    await applySettlementTx(tx, advance.id, amount, {
      kind: "CASH_RETURN",
      settledAt: date,
      journalEntryId: entry.id,
      note: input.note ?? null,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "SalaryAdvance",
        entityId: advance.id,
        summary: `${advance.employee.name} returned ${amount.toFixed(2)} on ${advance.number} (${input.method}), ${entry.number}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getAdvance(ctx, advanceId);
}

/** Undoes a cash return recorded by mistake: its entry is reversed and the amount is owed again. */
export async function voidAdvanceReturn(
  ctx: CompanyContext,
  advanceId: string,
  settlementId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanReceiveMoney(ctx, "Only Accounts can undo a return.");
  assertCanPayMoney(ctx, "Only Accounts can undo a return.");
  const { reason } = voidSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const advance = await lockAdvance(tx, ctx, advanceId);
    const settlement = await tx.advanceSettlement.findFirst({
      where: { id: settlementId, advanceId: advance.id },
    });
    if (!settlement?.journalEntryId || !isCashReturn({ kind: settlement.kind, hasEntry: true })) {
      throw new AppError("NOT_FOUND", "Cash return not found.");
    }
    assertAllowed(canUndoReturn(advance, { reversed: settlement.reversedAt !== null }));
    await reverseJournalEntry(tx, settlement.journalEntryId, {
      description: `Undo return on ${advance.number}: ${reason}`,
      postedById: ctx.user.id,
    });
    await tx.advanceSettlement.update({
      where: { id: settlement.id },
      data: { reversedAt: new Date() },
    });
    await tx.salaryAdvance.update({
      where: { id: advance.id },
      data: { outstanding: { increment: settlement.amount }, status: "OPEN" },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "SalaryAdvance",
        entityId: advance.id,
        summary: `Undid ${advance.employee.name}'s return of ${settlement.amount.toFixed(2)} on ${advance.number}: ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getAdvance(ctx, advanceId);
}

/**
 * Voids an advance recorded by mistake, before any of it was recovered: its
 * entry is reversed (the money is back in the account it came from).
 */
export async function voidAdvance(
  ctx: CompanyContext,
  advanceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = voidSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const advance = await lockAdvance(tx, ctx, advanceId);
    if (advance.isOpening) {
      assertCanManageAccounts(ctx, "Only Accounts can void advances brought forward.");
    } else {
      assertCanPayMoney(ctx, "Only Accounts can void advances.");
      assertCanReceiveMoney(ctx, "Only Accounts can void advances.");
    }
    const live = await tx.advanceSettlement.count({
      where: { advanceId: advance.id, reversedAt: null },
    });
    assertAllowed(canVoidAdvance(advance, live));
    if (advance.journalEntryId) {
      await reverseJournalEntry(tx, advance.journalEntryId, {
        description: `Void ${advance.number}: ${reason}`,
        postedById: ctx.user.id,
      });
    }
    await tx.salaryAdvance.update({
      where: { id: advance.id },
      data: { status: "VOID", outstanding: 0, voidedAt: new Date(), voidReason: reason },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "SalaryAdvance",
        entityId: advance.id,
        summary: `Voided ${advance.number} (${advance.amount.toFixed(2)} to ${advance.employee.name}): ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getAdvance(ctx, advanceId);
}

// =============================================================================
// Employee portal
// =============================================================================

/** The signed-in employee's advances and how they were settled. */
export async function myAdvances(ctx: CompanyContext) {
  const employee = await requireLinkedEmployee(ctx);
  const rows = await ctx.db.salaryAdvance.findMany({
    where: { employeeId: employee.id, status: { not: "VOID" } },
    include: advanceInclude,
    orderBy: { givenAt: "desc" },
  });
  return {
    outstanding: rows
      .filter((a) => a.status === "OPEN")
      .reduce((t, a) => t.plus(a.outstanding), ZERO)
      .toFixed(2),
    items: rows.map((a) => presentAdvance(a, ctx.company.timezone)),
  };
}
