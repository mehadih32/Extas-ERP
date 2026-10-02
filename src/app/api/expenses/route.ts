import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/expenses?status=PENDING|POSTED|REJECTED|VOID&headId=&category=&employeeId=&supplierId=
 * &mine=&from=&to=&search=&cursor=&take= — expenses (your own unless you manage expenses or accounts).
 */
export const GET = apiRoute(async (request) =>
  expenses.listExpenses(
    await requireAnyPermission(
      "expenses.create",
      "expenses.manage",
      "accounts.view",
      "accounts.payments.record",
    ),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/expenses — { headId, amount, date?, paymentType?: CASH_BANK | DUE, method?, accountId?,
 * reference?, supplierId?, employeeId?, purpose?, fromLocation?, toLocation?, description?,
 * receiptFileId? }. Cash expenses by anyone but Accounts are saved as claims for Accounts to pay.
 */
export const POST = apiRoute(
  async (request) =>
    expenses.createExpense(
      await requirePermission("expenses.create"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
