import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";

type Params = { expenseId: string };

export const dynamic = "force-dynamic";

/** POST /api/expenses/:expenseId/reject — { reason }: turns a claim down (or withdraws your own). */
export const POST = apiRoute<Params>(async (request, { expenseId }) =>
  expenses.rejectExpense(
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
