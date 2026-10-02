import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";

type Params = { expenseId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/expenses/:expenseId/approve — { method?, accountId?, reference?, date? }: Accounts pays
 * a claim back.
 */
export const POST = apiRoute<Params>(async (request, { expenseId }) =>
  expenses.approveExpense(
    await requirePermission("accounts.payments.record"),
    expenseId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
