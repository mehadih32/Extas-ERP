"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";
import * as screens from "@/modules/expenses/screens.service";
import * as files from "@/modules/files/file.service";

/*
 * Expense Server Actions (Quick Add). Each returns { ok: true, data } or { ok: false, error }.
 *   expenses.create           record expenses; cash ones become claims unless you are Accounts
 *   accounts.payments.record  pay claims back, pay cash expenses straight away (Accounts)
 *   expenses.manage           see, edit and void any expense; manage expense heads
 * People without expenses.manage / accounts.view see only the expenses they recorded.
 * Changes refresh the screens and hand back the expense's id, number and status
 * only: the full records carry Decimal amounts, which do not cross to the browser.
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

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

const ref = (expense: { id: string; number: string; status: string }) => ({
  id: expense.id,
  number: expense.number,
  status: expense.status,
});
const headRef = (head: { id: string; name: string }) => ({ id: head.id, name: head.name });

// --- Screens --------------------------------------------------------------------------------
export const getExpenseListAction = async (query: unknown) =>
  runAction(async () => screens.getExpenseList(await anyExpenseRole(), query));
export const listExpenseRowsAction = async (query: unknown) =>
  runAction(async () => screens.listExpenseRows(await anyExpenseRole(), query));
export const getExpenseScreenAction = async (expenseId: string) =>
  runAction(async () => screens.getExpenseScreen(await anyExpenseRole(), expenseId));
/** A new expense needs expenses.create; changing one is decided by the expense rules. */
export const getExpenseFormAction = async (expenseId?: string) =>
  runAction(async () =>
    screens.getExpenseForm(expenseId ? await anyExpenseRole() : await record(), expenseId),
  );
export const getExpenseHeadsScreenAction = async () =>
  runAction(async () => screens.getExpenseHeadsScreen(await anyExpenseRole()));
/** FormData with a `file` field: a receipt or memo photo, or a PDF (10 MB max). */
export const uploadExpenseReceiptAction = async (form: FormData) =>
  runAction(async () => {
    const asset = await files.storeUpload(
      await requireAnyPermission("expenses.create", "expenses.manage"),
      await files.fileFromForm(form),
      await getRequestMeta(),
    );
    return { id: asset.id, fileName: asset.fileName };
  });

// --- Heads ----------------------------------------------------------------------------------
export const listExpenseHeadsAction = async (query: unknown) =>
  runAction(async () => expenses.listExpenseHeads(await anyExpenseRole(), query));
export const createExpenseHeadAction = async (input: unknown) =>
  change(async () =>
    headRef(await expenses.createExpenseHead(await manageHeads(), input, await getRequestMeta())),
  );
export const updateExpenseHeadAction = async (headId: string, input: unknown) =>
  change(async () =>
    headRef(
      await expenses.updateExpenseHead(await manageHeads(), headId, input, await getRequestMeta()),
    ),
  );

// --- Expenses & claims ---------------------------------------------------------------------------
export const listExpensesAction = async (query: unknown) =>
  runAction(async () => expenses.listExpenses(await anyExpenseRole(), query));
export const getExpenseAction = async (expenseId: string) =>
  runAction(async () => expenses.getExpense(await anyExpenseRole(), expenseId));
export const createExpenseAction = async (input: unknown) =>
  change(async () =>
    ref(await expenses.createExpense(await record(), input, await getRequestMeta())),
  );
/** Expense managers edit anything; others only their own claims while they wait. */
export const updateExpenseAction = async (expenseId: string, input: unknown) =>
  change(async () =>
    ref(
      await expenses.updateExpense(
        await anyExpenseRole(),
        expenseId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const approveExpenseAction = async (expenseId: string, input: unknown) =>
  change(async () =>
    ref(
      await expenses.approveExpense(
        await requirePermission("accounts.payments.record"),
        expenseId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
/** Accounts or expense managers turn a claim down; its author can withdraw it. */
export const rejectExpenseAction = async (expenseId: string, input: unknown) =>
  change(async () =>
    ref(
      await expenses.rejectExpense(
        await anyExpenseRole(),
        expenseId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const voidExpenseAction = async (expenseId: string, input: unknown) =>
  change(async () =>
    ref(
      await expenses.voidExpense(
        await requirePermission("expenses.manage"),
        expenseId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
