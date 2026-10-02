import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/reports/export.service";

type Params = { exportId: string };

export const dynamic = "force-dynamic";

/** GET /api/reports/exports/:exportId/download — the PDF or Excel file. Every download is audited. */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  try {
    const { exportId } = await context.params;
    const file = await reports.downloadReportExport(
      await requirePermission("reports.export"),
      exportId,
      await getRequestMeta(),
    );
    return fileResponse(file);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
