import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { batchSummaryPdf } from "@/modules/production/batch-summary.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/summary/pdf — the batch summary as a PDF: total
 * cost, cost a good piece, penalties and deductions, and stock (production.manage or
 * accounts.view).
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { batchId } = await context.params;
    const ctx = await requireAnyPermission("production.manage", "accounts.view");
    const pdf = await batchSummaryPdf(ctx, batchId, await getRequestMeta());
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
