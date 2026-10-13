import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as finishing from "@/modules/production/finishing.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/projects/:projectId/finishing/mending — { countedOn?, lines: [{
 * colorName?, sizeName?, a, b, reject }], note? }: C-grade pieces back from mending as A, B
 * or reject (production.manage or production.stock_intake).
 */
export const POST = apiRoute<Params>(
  async (request, { projectId }) =>
    finishing.backFromMending(
      await requireAnyPermission("production.manage", "production.stock_intake"),
      projectId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
