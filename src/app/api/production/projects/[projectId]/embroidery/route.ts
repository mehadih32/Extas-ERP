import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as cutting from "@/modules/production/cutting.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/projects/:projectId/embroidery — { kind: EMBROIDERY | PRINT, partyId?,
 * sentOn?, dueOn?, lines: [{ colorName?, sizeName?, quantity }], note? }: sends cut pieces out,
 * no more than are cut and not already out (production.manage).
 */
export const POST = apiRoute<Params>(
  async (request, { projectId }) =>
    cutting.sendToEmbroidery(
      await requirePermission("production.manage"),
      projectId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
