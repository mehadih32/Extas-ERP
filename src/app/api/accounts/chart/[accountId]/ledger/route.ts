import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as chart from "@/modules/accounts/chart.service";

type Params = { accountId: string };

export const dynamic = "force-dynamic";

/** GET /api/accounts/chart/:accountId/ledger?from=&to= — date-wise lines with a running balance. */
export const GET = apiRoute<Params>(async (request, { accountId }) =>
  chart.getAccountLedger(
    await requirePermission("accounts.view"),
    accountId,
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
