import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as issues from "@/modules/materials/issue.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/materials/issues?kind=ISSUE|RETURN&projectId=&warehouseId=&materialId=&from=&to=
 * &cursor=&take= — issue notes (MI-) and return notes (MR-).
 */
export const GET = apiRoute(async (request) =>
  issues.listIssues(
    await requirePermission("materials.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/materials/issues — { projectId, warehouseId?, date?, receivedBy?, note?,
 * lines: [{ materialId, quantity }] }. Materials leave the store at average cost and are charged
 * to the project's work in progress. Needs materials.manage.
 */
export const POST = apiRoute(
  async (request) =>
    issues.issueToProduction(
      await requirePermission("materials.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
