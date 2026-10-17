import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { employeeReportPdf } from "@/modules/hr/report.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees/:employeeId/report — the employee's 360° report as a PDF download:
 * the last 12 months of attendance, approved overtime and tasks, and the salary and
 * conveyance for people who see them, with a summary. Made for each request, never kept.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { employeeId } = await context.params;
    const ctx = await requireAnyPermission("hr.view", "hr.manage", "hr.payroll");
    const pdf = await employeeReportPdf(ctx, employeeId, await getRequestMeta());
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
