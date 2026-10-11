import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as vault from "@/modules/hr/vault.service";

type Params = { requestId: string };

export const dynamic = "force-dynamic";

/** POST /api/hr/pay-details-requests/:requestId/reject — { reason }: the pay details stay. */
export const POST = apiRoute<Params>(async (request, { requestId }) =>
  vault.rejectPayRequest(
    await requirePermission("hr.manage"),
    requestId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
