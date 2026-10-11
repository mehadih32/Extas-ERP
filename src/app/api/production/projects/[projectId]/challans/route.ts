import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as challans from "@/modules/production/challan.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/** GET /api/production/projects/:projectId/challans — the materials sent for the project (MC-). */
export const GET = apiRoute<Params>(async (_request, { projectId }) =>
  challans.listMaterialChallans(await requirePermission("production.view"), projectId),
);

/**
 * POST /api/production/projects/:projectId/challans — { sentOn?, sentTo?, items: [{ description,
 * quantity, unit }], carrier?, notes? }. Records what went to the factory under the next MC-
 * number (sentTo defaults to the project's factory). Moves no stock and no money.
 */
export const POST = apiRoute<Params>(
  async (request, { projectId }) =>
    challans.createMaterialChallan(
      await requirePermission("production.manage"),
      projectId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
