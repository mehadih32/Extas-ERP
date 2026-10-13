import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as finishing from "@/modules/production/finishing.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/projects/:projectId/finishing/packing-list — { countedOn?, missing?:
 * [{ colorName?, sizeName?, quantity }], warehouseId?, closeStyle?, allowZeroCost?, fileId?,
 * note? }: Receive Full Packing List. Every A and B piece counted and not yet in stock goes
 * to the Sales stock on one delivery; missing pieces go into the factory's fault log at the
 * final unit cost; closeStyle (production.manage) closes the style (production.stock_intake).
 */
export const POST = apiRoute<Params>(
  async (request, { projectId }) =>
    finishing.receivePackingList(
      await requirePermission("production.stock_intake"),
      projectId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
