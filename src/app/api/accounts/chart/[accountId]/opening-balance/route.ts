import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as chart from "@/modules/accounts/chart.service";

type Params = { accountId: string };

export const dynamic = "force-dynamic";

/**
 * PUT /api/accounts/chart/:accountId/opening-balance — { amount, asOf? }: balance brought
 * forward on the go-live day (cash, bank, wallets, advances, other balances).
 */
export const PUT = apiRoute<Params>(async (request, { accountId }) =>
  chart.setAccountOpeningBalance(
    await requirePermission("accounts.manage"),
    accountId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
