import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as vault from "@/modules/hr/vault.service";

type Params = { requestId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/pay-details-requests/:requestId/approve — { note? }: the employee's salary goes the
 * new way from now on. Not for a change to one's own pay details (a Super Admin aside).
 */
export const POST = apiRoute<Params>(async (request, { requestId }) =>
  vault.approvePayRequest(
    await requirePermission("hr.manage"),
    requestId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
