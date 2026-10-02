"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";

/*
 * Expense Server Actions (Quick Add). Each returns { ok: true, data } or { ok: false, error }.
 *   expenses.create           record expenses; cash ones become claims unless you are Accounts
 *   accounts.payments.record  pay claims back, pay cash expenses straight away (Accounts)
 *   expenses.manage           see, edit and void any expense; manage expense heads
 * People without expenses.manage / accounts.view see only the expenses they recorded.
 */

const record = () => requirePermission("expenses.create");
const anyExpenseRole = () =>
  requireAnyPermission(
    "expenses.create",
    "expenses.manage",
    "accounts.view",
    "accounts.payments.record",
  );
const manageHeads = () => requireAnyPermission("expenses.manage", "accounts.manage");

// --- Heads ----------------------------------------------------------------------------------
export const listExpenseHeadsAction = async (query: unknown) =>
  runAction(async () => expenses.listExpenseHeads(await anyExpenseRole(), query));
export const createExpenseHeadAction = async (input: unknown) =>
  runAction(async () =>
    expenses.createExpenseHead(await manageHeads(), input, await getRequestMeta()),
  );
export const updateExpenseHeadAction = async (headId: string, input: unknown) =>
  runAction(async () =>
    expenses.updateExpenseHead(await manageHeads(), headId, input, await getRequestMeta()),
  );

// --- Expenses & claims ---------------------------------------------------------------------------
export const listExpensesAction = async (query: unknown) =>
  runAction(async () => expenses.listExpenses(await anyExpenseRole(), query));
export const getExpenseAction = async (expenseId: string) =>
  runAction(async () => expenses.getExpense(await anyExpenseRole(), expenseId));
export const createExpenseAction = async (input: unknown) =>
  runAction(async () => expenses.createExpense(await record(), input, await getRequestMeta()));
/** Expense managers edit anything; others only their own claims while they wait. */
export const updateExpenseAction = async (expenseId: string, input: unknown) =>
  runAction(async () =>
    expenses.updateExpense(await anyExpenseRole(), expenseId, input, await getRequestMeta()),
  );
export const approveExpenseAction = async (expenseId: string, input: unknown) =>
  runAction(async () =>
    expenses.approveExpense(
      await requirePermission("accounts.payments.record"),
      expenseId,
      input,
      await getRequestMeta(),
    ),
  );
/** Accounts or expense managers turn a claim down; its author can withdraw it. */
export const rejectExpenseAction = async (expenseId: string, input: unknown) =>
  runAction(async () =>
    expenses.rejectExpense(await anyExpenseRole(), expenseId, input, await getRequestMeta()),
  );
export const voidExpenseAction = async (expenseId: string, input: unknown) =>
  runAction(async () =>
    expenses.voidExpense(
      await requirePermission("expenses.manage"),
      expenseId,
      input,
      await getRequestMeta(),
    ),
  );
