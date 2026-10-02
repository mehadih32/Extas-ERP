import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/reports/export.service";

type Params = { exportId: string };

export const dynamic = "force-dynamic";

/** GET /api/reports/exports/:exportId */
export const GET = apiRoute<Params>(async (_request, { exportId }) =>
  reports.getReportExport(await requirePermission("reports.export"), exportId),
);

/** DELETE /api/reports/exports/:exportId — by the person who made it, or a Super Admin. */
export const DELETE = apiRoute<Params>(async (_request, { exportId }) =>
  reports.deleteReportExport(
    await requirePermission("reports.export"),
    exportId,
    await getRequestMeta(),
  ),
);
