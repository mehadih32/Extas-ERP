import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as challans from "@/modules/production/challan.service";

type Params = { challanId: string };

export const dynamic = "force-dynamic";

/** POST /api/production/challans/:challanId/cancel — { reason }. It stays on record, marked cancelled. */
export const POST = apiRoute<Params>(async (request, { challanId }) =>
  challans.cancelMaterialChallan(
    await requirePermission("production.manage"),
    challanId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
