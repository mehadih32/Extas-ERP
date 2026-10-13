import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as needs from "@/modules/production/material-need.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/material-needs — the style's materials per
 * piece, what its pieces need of each (per colour and size when split) and how much of
 * that is on purchase orders.
 */
export const GET = apiRoute<Params>(async (_request, { projectId }) =>
  needs.getMaterialNeeds(await requirePermission("production.view"), projectId),
);

/**
 * PUT /api/production/projects/:projectId/material-needs — { needs: [{ materialId, perPiece,
 * wastagePercent?, split?, placement?, imageId?, notes? }] } replaces them all.
 */
export const PUT = apiRoute<Params>(async (request, { projectId }) =>
  needs.setMaterialNeeds(
    await requirePermission("production.manage"),
    projectId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
