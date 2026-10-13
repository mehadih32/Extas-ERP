import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { cmSettlementPdf } from "@/modules/production/batch-money.service";

type Params = { settlementId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/cm-settlements/:settlementId/pdf — the factory's final CM bill as a
 * PDF: CM by style, the deductions, the advance taken and the final payable
 * (production.manage or accounts.view).
 */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  try {
    const { settlementId } = await context.params;
    const ctx = await requireAnyPermission("production.manage", "accounts.view");
    const pdf = await cmSettlementPdf(ctx, settlementId, await getRequestMeta());
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
