import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";

type Params = { headId: string };

export const dynamic = "force-dynamic";

/** PATCH /api/expenses/heads/:headId — { name?, category?, requiresEmployee?, ledgerAccountId?, isActive? }. */
export const PATCH = apiRoute<Params>(async (request, { headId }) =>
  expenses.updateExpenseHead(
    await requireAnyPermission("expenses.manage", "accounts.manage"),
    headId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
