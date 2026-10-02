import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as issues from "@/modules/materials/issue.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/materials/issues/returns — { projectId, warehouseId?, date?, receivedBy?, note?,
 * lines: [{ materialId, quantity }] }. Unused materials come back from the project at what it was
 * charged for them. Needs materials.manage.
 */
export const POST = apiRoute(
  async (request) =>
    issues.returnFromProduction(
      await requirePermission("materials.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
