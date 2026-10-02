import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as costs from "@/modules/production/cost.service";

type Params = { headId: string };

export const dynamic = "force-dynamic";

/** PATCH /api/production/cost-heads/:headId — { name?, isActive? }. */
export const PATCH = apiRoute<Params>(async (request, { headId }) =>
  costs.updateCostHead(
    await requirePermission("production.manage"),
    headId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
