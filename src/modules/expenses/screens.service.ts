import { localDay } from "@/lib/dates";
import { assertAllowed } from "@/lib/verdict";
import { EXPENSE_CATEGORY_ACCOUNTS, type GeneralExpenseCategory } from "@/modules/accounts/chart";
import { accountsAccess, listMoneyAccounts } from "@/modules/accounts/screens.service";
import type { CompanyContext } from "@/modules/auth/context";
import { getExpense, listExpenseHeads, listExpenses } from "@/modules/expenses/expense.service";
import {
  canApproveExpense,
  canEditExpense,
  canRejectExpense,
  canVoidExpense,
} from "@/modules/expenses/rules";
import { linkedEmployee } from "@/modules/hr/access";
import { employeeDirectory } from "@/modules/hr/employee.service";

/*
 * What the Expenses screens show, as plain values, with what the person
 * looking may do decided by the same permissions and rules the expense actions
 * use (expenses/rules.ts):
 *   expenses.create           record expenses; anyone but Accounts makes claims
 *   accounts.payments.record  pay expenses now, pay claims back (Accounts)
 *   expenses.manage           every expense: edit, void, Due expenses, heads
 * People who do not see every expense (no expenses.manage, accounts.view or
 * accounts.payments.record) see only the ones they recorded.
 */

export function expensesAccess(ctx: CompanyContext) {
  const pay = ctx.can("accounts.payments.record");
  const manage = ctx.can("expenses.manage");
  return {
    record: ctx.can("expenses.create"),
    manage,
    pay,
    seesAll: manage || ctx.can("accounts.view") || pay,
    manageHeads: manage || ctx.can("accounts.manage"),
    /** A Due expense names the supplier, chosen from the suppliers list. */
    findSuppliers: accountsAccess(ctx).findParties,
    openEntry: ctx.can("accounts.view"),
    openParty: ctx.can("parties.view"),
  };
}

type ExpenseData = Awaited<ReturnType<typeof getExpense>>;

const stateOf = (ctx: CompanyContext, e: ExpenseData) => ({
  number: e.number,
  status: e.status,
  paymentType: e.paymentType,
  own: e.createdBy?.id === ctx.user.id,
});

function presentRow(e: ExpenseData, tz: string) {
  return {
    id: e.id,
    number: e.number,
    spentOn: localDay(e.date, tz),
    status: e.status,
    head: e.head.name,
    amount: e.amount,
    paymentType: e.paymentType,
    paidFrom: e.paidFrom?.name ?? null,
    fromAdvance: e.fromAdvance,
    supplier: e.supplier?.name ?? null,
    employee: e.employee?.name ?? null,
    details: e.purpose ?? e.description ?? null,
    createdBy: e.createdBy?.name ?? null,
    hasReceipt: Boolean(e.receiptFile),
  };
}

export type ExpenseRow = ReturnType<typeof presentRow>;

export async function listExpenseRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listExpenses(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((e) => presentRow(e, tz)), nextCursor: page.nextCursor };
}

/**
 * The Expenses tab: the first page, the heads to filter by, how many claims are
 * waiting, and whether this person sees everyone's expenses or only their own.
 */
export async function getExpenseList(ctx: CompanyContext, raw: unknown = {}) {
  const access = expensesAccess(ctx);
  const [page, heads, waiting] = await Promise.all([
    listExpenseRows(ctx, raw),
    listExpenseHeads(ctx, { includeInactive: true }),
    ctx.db.expense.count({
      where: {
        projectId: null,
        journalEntryId: null,
        voidedAt: null,
        ...(access.seesAll ? {} : { createdById: ctx.user.id }),
      },
    }),
  ]);
  return {
    ...page,
    heads: heads.map((h) => ({ id: h.id, name: h.name })),
    waiting,
    seesAll: access.seesAll,
    can: { create: access.record, payClaims: access.pay, manageHeads: access.manageHeads },
  };
}

export type ExpenseList = Awaited<ReturnType<typeof getExpenseList>>;

/**
 * One expense or claim: what it was for, how it was paid, its receipt, and
 * what this person may do with it (approve, turn down or withdraw, void, edit).
 */
export async function getExpenseScreen(ctx: CompanyContext, expenseId: string) {
  const e = await getExpense(ctx, expenseId);
  const access = expensesAccess(ctx);
  const tz = ctx.company.timezone;
  const state = stateOf(ctx, e);
  const head = await ctx.db.expenseHead.findUnique({
    where: { id: e.head.id },
    select: { requiresEmployee: true },
  });
  const approve = canApproveExpense(ctx, state).ok;
  return {
    today: localDay(new Date(), tz),
    expense: {
      id: e.id,
      number: e.number,
      spentOn: localDay(e.date, tz),
      status: e.status,
      head: {
        id: e.head.id,
        name: e.head.name,
        category: e.head.category,
        requiresEmployee: head?.requiresEmployee ?? false,
      },
      amount: e.amount,
      paymentType: e.paymentType,
      paidFrom: e.paidFrom,
      fromAdvance: e.fromAdvance,
      advances: e.advanceSettlements.map((s) => ({
        number: s.advance.number,
        amount: s.amount,
        undone: Boolean(s.reversedAt),
      })),
      supplier: e.supplier,
      employee: e.employee,
      purpose: e.purpose,
      fromLocation: e.fromLocation,
      toLocation: e.toLocation,
      description: e.description,
      receipt: e.receiptFile ? { id: e.receiptFile.id, fileName: e.receiptFile.fileName } : null,
      createdBy: e.createdBy?.name ?? null,
      recordedOn: localDay(e.createdAt, tz),
      journalEntry: e.journalEntry
        ? { id: e.journalEntry.id, number: e.journalEntry.number }
        : null,
      voidedOn: e.voidedAt ? localDay(e.voidedAt, tz) : null,
      voidReason: e.voidReason,
      own: state.own,
    },
    /** Where Accounts pays a cash claim back from. */
    accounts: approve && e.paymentType === "CASH_BANK" ? await listMoneyAccounts(ctx) : [],
    can: {
      approve,
      reject: canRejectExpense(ctx, state).ok,
      void: canVoidExpense(ctx, state).ok,
      edit: canEditExpense(ctx, state).ok,
      openEntry: access.openEntry && Boolean(e.journalEntry),
      openParty: access.openParty,
    },
  };
}

export type ExpenseScreen = Awaited<ReturnType<typeof getExpenseScreen>>;

/**
 * What the expense form needs: the heads, the employees conveyance and food
 * name (the person's own profile first), where Accounts pays from, and how
 * this person's expense lands (in the books now, or as a claim). With an
 * expense, its details to change: the amount, head and date only while it waits.
 */
export async function getExpenseForm(ctx: CompanyContext, expenseId?: string) {
  const access = expensesAccess(ctx);
  const expense = expenseId ? await getExpense(ctx, expenseId) : null;
  if (expense) assertAllowed(canEditExpense(ctx, stateOf(ctx, expense)));
  const heads = await listExpenseHeads(ctx, {});
  const current =
    expense && !heads.some((h) => h.id === expense.head.id)
      ? await ctx.db.expenseHead.findUnique({ where: { id: expense.head.id } })
      : null;
  const allHeads = current ? [...heads, current] : heads;
  const needsEmployee = allHeads.some((h) => h.requiresEmployee);
  const [employees, linked, accounts] = await Promise.all([
    needsEmployee ? employeeDirectory(ctx, {}) : [],
    linkedEmployee(ctx),
    access.pay && !expense ? listMoneyAccounts(ctx) : [],
  ]);
  return {
    today: localDay(new Date(), ctx.company.timezone),
    heads: allHeads.map((h) => ({
      id: h.id,
      name: h.name,
      requiresEmployee: h.requiresEmployee,
      isActive: h.isActive,
    })),
    employees: employees.map((e) => ({ id: e.id, code: e.code, name: e.name })),
    linkedEmployeeId: linked?.id ?? null,
    accounts,
    can: {
      /** Paid now from cash, bank or a wallet (Accounts); anyone else's is a claim. */
      payNow: access.pay,
      /** Owed to a supplier: needs the suppliers list. */
      due: access.findSuppliers,
      /** A Due expense goes straight on the supplier's account. */
      dueInBooks: access.pay || access.manage,
    },
    expense: expense
      ? {
          id: expense.id,
          number: expense.number,
          status: expense.status,
          spentOn: localDay(expense.date, ctx.company.timezone),
          headId: expense.head.id,
          amount: expense.amount,
          paymentType: expense.paymentType,
          supplier: expense.supplier?.name ?? null,
          employeeId: expense.employee?.id ?? null,
          purpose: expense.purpose,
          fromLocation: expense.fromLocation,
          toLocation: expense.toLocation,
          description: expense.description,
          receipt: expense.receiptFile
            ? { id: expense.receiptFile.id, fileName: expense.receiptFile.fileName }
            : null,
        }
      : null,
  };
}

export type ExpenseForm = Awaited<ReturnType<typeof getExpenseForm>>;

/** The expense heads (archived ones too) with the account each posts to, and changing them. */
export async function getExpenseHeadsScreen(ctx: CompanyContext) {
  const access = expensesAccess(ctx);
  const [heads, accounts] = await Promise.all([
    listExpenseHeads(ctx, { includeInactive: true }),
    access.manageHeads
      ? ctx.db.ledgerAccount.findMany({
          where: { type: "EXPENSE", subType: { not: "COGS" }, isActive: true },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
        })
      : [],
  ]);
  return {
    heads: heads.map((h) => {
      const fallback = EXPENSE_CATEGORY_ACCOUNTS[h.category as GeneralExpenseCategory];
      return {
        id: h.id,
        name: h.name,
        category: h.category as GeneralExpenseCategory,
        requiresEmployee: h.requiresEmployee,
        isActive: h.isActive,
        accountId: h.ledgerAccount?.id ?? null,
        account: h.ledgerAccount
          ? `${h.ledgerAccount.code} ${h.ledgerAccount.name}`
          : fallback
            ? `${fallback.code} ${fallback.name}`
            : null,
      };
    }),
    accounts,
    canManage: access.manageHeads,
  };
}

export type ExpenseHeadsScreen = Awaited<ReturnType<typeof getExpenseHeadsScreen>>;
