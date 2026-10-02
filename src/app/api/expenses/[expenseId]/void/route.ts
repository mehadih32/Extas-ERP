import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";

type Params = { expenseId: string };

export const dynamic = "force-dynamic";

/** POST /api/expenses/:expenseId/void — { reason }: reverses an expense in the books. */
export const POST = apiRoute<Params>(async (request, { expenseId }) =>
  expenses.voidExpense(
    await requirePermission("expenses.manage"),
    expenseId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
