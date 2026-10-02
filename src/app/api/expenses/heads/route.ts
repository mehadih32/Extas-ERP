import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";

export const dynamic = "force-dynamic";

/** GET /api/expenses/heads?includeInactive= — expense heads (Office Rent, Conveyance...). */
export const GET = apiRoute(async (request) =>
  expenses.listExpenseHeads(
    await requireAnyPermission(
      "expenses.create",
      "expenses.manage",
      "accounts.view",
      "accounts.payments.record",
    ),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/** POST /api/expenses/heads — { name, category, requiresEmployee?, ledgerAccountId? }. */
export const POST = apiRoute(
  async (request) =>
    expenses.createExpenseHead(
      await requireAnyPermission("expenses.manage", "accounts.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
