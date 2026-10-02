import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as issues from "@/modules/materials/issue.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/materials — materials issued to the project, returned
 * and still with it, its issue and return notes, and purchase orders still due for it.
 * Costs need materials.purchase, production.manage or accounts.view.
 */
export const GET = apiRoute<Params>(async (_request, { projectId }) =>
  issues.getProjectMaterials(
    await requireAnyPermission("materials.view", "production.view"),
    projectId,
  ),
);
