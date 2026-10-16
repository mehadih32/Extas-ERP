import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { contractPdf } from "@/modules/production/contract.service";

type Params = { contractId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/contracts/:contractId/pdf — the agreement as a PDF to review and
 * sign: letterhead, both sides, what it covers, its numbered clauses and signature lines.
 * Made for each request, never kept.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { contractId } = await context.params;
    const ctx = await requireAnyPermission("production.manage", "accounts.view");
    const pdf = await contractPdf(ctx, contractId, await getRequestMeta());
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
