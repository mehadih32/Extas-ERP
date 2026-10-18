import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { TECH_PACK_READ } from "@/modules/production/tech-pack-access";
import { techPackPdfOf } from "@/modules/production/tech-pack.service";

type Params = { techPackId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/tech-packs/:techPackId/pdf — the tech pack as a PDF: its style's (pieces,
 * materials per piece, chart, logos and colours) once linked to a style in production;
 * until then its own, from the buyer's brief and what is on it. No prices. Made for
 * each request, never kept.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { techPackId } = await context.params;
    const ctx = await requireAnyPermission(...TECH_PACK_READ);
    const pdf = await techPackPdfOf(ctx, techPackId, await getRequestMeta());
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
