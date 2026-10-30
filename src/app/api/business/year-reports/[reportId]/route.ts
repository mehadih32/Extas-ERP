import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany } from "@/modules/auth/context";
import { yearReportFile } from "@/modules/retail/pad.service";

export const dynamic = "force-dynamic";

/** GET /api/business/year-reports/{id} — a store's kept year-end summary (PDF), logged. */
export async function GET(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const { reportId } = await params;
    const ctx = await requireCompany();
    return fileResponse(await yearReportFile(ctx, reportId, await getRequestMeta()));
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
