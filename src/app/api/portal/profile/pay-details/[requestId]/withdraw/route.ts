import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as vault from "@/modules/hr/vault.service";

type Params = { requestId: string };

export const dynamic = "force-dynamic";

/** POST /api/portal/profile/pay-details/:requestId/withdraw — takes back a change still waiting. */
export const POST = apiRoute<Params>(async (_request, { requestId }) =>
  vault.withdrawMyPayRequest(
    await requirePermission("portal.self"),
    requestId,
    await getRequestMeta(),
  ),
);
