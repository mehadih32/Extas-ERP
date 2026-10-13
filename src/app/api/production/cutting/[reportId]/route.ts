import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as cutting from "@/modules/production/cutting.service";

type Params = { reportId: string };

export const dynamic = "force-dynamic";

/**
 * DELETE /api/production/cutting/:reportId — deletes a cutting report entered by mistake,
 * unless its pieces went out for embroidery or print (production.manage).
 */
export const DELETE = apiRoute<Params>(async (_request, { reportId }) =>
  cutting.deleteCuttingReport(
    await requirePermission("production.manage"),
    reportId,
    await getRequestMeta(),
  ),
);
