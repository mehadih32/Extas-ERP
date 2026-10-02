import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as chart from "@/modules/accounts/chart.service";

type Params = { accountId: string };

export const dynamic = "force-dynamic";

/** GET /api/accounts/chart/:accountId — one account with its balance. */
export const GET = apiRoute<Params>(async (_request, { accountId }) =>
  chart.getAccount(await requirePermission("accounts.view"), accountId),
);

/** PATCH /api/accounts/chart/:accountId — { name?, isActive? } (archive only at zero balance). */
export const PATCH = apiRoute<Params>(async (request, { accountId }) =>
  chart.updateAccount(
    await requirePermission("accounts.manage"),
    accountId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
