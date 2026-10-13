import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as cutting from "@/modules/production/cutting.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/cutting — the style's cutting: pieces cut, sent out
 * and spoiled by colour and size, the cross-checks against fabric, collars and cuffs and
 * accessories, the cutting reports, the embroidery and print jobs and the cutting and
 * sewing dates (production.view).
 */
export const GET = apiRoute<Params>(async (_request, { projectId }) =>
  cutting.getCuttingScreen(await requirePermission("production.view"), projectId),
);

/**
 * POST /api/production/projects/:projectId/cutting — { cutOn?, lines: [{ colorName?,
 * sizeName?, quantity }], fabricUsed?: [{ materialId, quantity }], photoId?, readByAi?, note? }:
 * saves a cutting report, then checks it and alerts on a shortage (production.manage).
 */
export const POST = apiRoute<Params>(
  async (request, { projectId }) =>
    cutting.createCuttingReport(
      await requirePermission("production.manage"),
      projectId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
