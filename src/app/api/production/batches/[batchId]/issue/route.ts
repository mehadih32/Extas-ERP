import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as batchIssue from "@/modules/production/batch-issue.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/issue?store= — each material the batch's open styles
 * need, what is in the store, and per style its need by colour, what it holds and what is
 * still to issue (materials.manage).
 */
export const GET = apiRoute<Params>(async (request, { batchId }) =>
  batchIssue.getBatchIssue(
    await requirePermission("materials.manage"),
    batchId,
    new URL(request.url).searchParams.get("store") ?? undefined,
  ),
);

/**
 * POST /api/production/batches/:batchId/issue — { warehouseId?, date?, receivedBy?, lines:
 * [{ projectId, materialId, colorName?, quantity }] }: one issue note per style, all or none.
 */
export const POST = apiRoute<Params>(
  async (request, { batchId }) =>
    batchIssue.issueToStyles(
      await requirePermission("materials.manage"),
      batchId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
