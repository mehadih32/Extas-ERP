import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as finishing from "@/modules/production/finishing.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/finishing — the style's finishing: pieces graded
 * A, B and C (mending), rejects, missing and not counted yet by colour and size, what is in
 * stock and still to go, the reports, the full packing list and (for those who see costs)
 * the final unit cost, total cost ÷ (A + B) (production.view).
 */
export const GET = apiRoute<Params>(async (_request, { projectId }) =>
  finishing.getFinishingScreen(await requirePermission("production.view"), projectId),
);

/**
 * POST /api/production/projects/:projectId/finishing — { countedOn?, lines: [{ colorName?,
 * sizeName?, a, b, c, reject }], fileId?, note? }: a finishing count, grading pieces A, B or
 * C (to mending) with rejects apart (production.manage or production.stock_intake).
 */
export const POST = apiRoute<Params>(
  async (request, { projectId }) =>
    finishing.createFinishingCount(
      await requireAnyPermission("production.manage", "production.stock_intake"),
      projectId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
