import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";

type Params = { expenseId: string };

export const dynamic = "force-dynamic";

/** GET /api/expenses/:expenseId */
export const GET = apiRoute<Params>(async (_request, { expenseId }) =>
  expenses.getExpense(
    await requireAnyPermission(
      "expenses.create",
      "expenses.manage",
      "accounts.view",
      "accounts.payments.record",
    ),
    expenseId,
  ),
);

/** PATCH /api/expenses/:expenseId — details; amount, head and date only while it is a claim. */
export const PATCH = apiRoute<Params>(async (request, { expenseId }) =>
  expenses.updateExpense(
    await requireAnyPermission(
      "expenses.create",
      "expenses.manage",
      "accounts.view",
      "accounts.payments.record",
    ),
    expenseId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
