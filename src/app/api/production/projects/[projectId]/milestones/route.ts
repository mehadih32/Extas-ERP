import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as cutting from "@/modules/production/cutting.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * PATCH /api/production/projects/:projectId/milestones — { cutBy?, sewBy? }: the days
 * cutting and sewing are to be done by, on or before the target day (production.manage).
 */
export const PATCH = apiRoute<Params>(async (request, { projectId }) =>
  cutting.setMilestones(
    await requirePermission("production.manage"),
    projectId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
