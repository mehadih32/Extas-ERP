import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { techPackPdf } from "@/modules/production/tech-pack.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/tech-pack — the style's tech pack as a PDF: its
 * pieces per colour and size, materials per piece with pictures, collar and cuff matrices
 * and making notes. No prices. Made for each request, never kept.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { projectId } = await context.params;
    const ctx = await requirePermission("production.view");
    const pdf = await techPackPdf(ctx, projectId, await getRequestMeta());
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
