import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as bank from "@/modules/accounts/bank.service";

type Params = { bankAccountId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/bank-accounts/:bankAccountId/statement?from=&to= — the bank statement:
 * letterhead, account details, summary, month-by-month balances and every transaction.
 */
export const GET = apiRoute<Params>(async (request, { bankAccountId }) =>
  bank.getBankStatement(
    await requirePermission("accounts.view"),
    bankAccountId,
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
