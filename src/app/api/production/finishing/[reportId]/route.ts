import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as finishing from "@/modules/production/finishing.service";

type Params = { reportId: string };

export const dynamic = "force-dynamic";

/**
 * DELETE /api/production/finishing/:reportId — deletes a finishing count or mending return
 * entered by mistake; never a packing list, whose delivery is undone instead
 * (production.manage or production.stock_intake).
 */
export const DELETE = apiRoute<Params>(async (_request, { reportId }) =>
  finishing.deleteFinishingReport(
    await requireAnyPermission("production.manage", "production.stock_intake"),
    reportId,
    await getRequestMeta(),
  ),
);
