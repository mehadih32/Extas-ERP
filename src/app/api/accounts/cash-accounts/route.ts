import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as chart from "@/modules/accounts/chart.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/cash-accounts — cash, bank and wallet accounts with balances. */
export const GET = apiRoute(async () =>
  chart.listCashAccounts(
    await requireAnyPermission(
      "accounts.view",
      "accounts.receipts.record",
      "accounts.payments.record",
    ),
  ),
);
