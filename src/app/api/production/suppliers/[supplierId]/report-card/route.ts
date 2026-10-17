import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { reportCardPdf } from "@/modules/production/report-card.service";

type Params = { supplierId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/suppliers/:supplierId/report-card — the supplier's report card for the
 * last 12 months as a PDF: on-time deliveries, Challan vs Actual, the fault log, contracts, a
 * grade and a summary. Values on it: Production Managers, buyers and Accounts.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { supplierId } = await context.params;
    const ctx = await requireAnyPermission(
      "production.manage",
      "materials.purchase",
      "accounts.view",
    );
    const pdf = await reportCardPdf(ctx, supplierId, await getRequestMeta());
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
