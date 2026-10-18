import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { TECH_PACK_READ } from "@/modules/production/tech-pack-access";
import { requireProjectTechPack } from "@/modules/production/tech-pack-spec.service";
import { digitizingBrief } from "@/modules/production/tech-pack-export";

type Params = { projectId: string; logoId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/tech-pack/logos/:logoId/brief — the digitizing
 * brief for the embroidery factory's puncher (size, threads, position, fabric, the formats
 * needed and the sew-out test). Made for each request, never kept.
 * The address from before v6.4: the same file as /api/tech-packs/:techPackId/..., for
 * the style's tech pack (not found while it has none).
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { projectId, logoId } = await context.params;
    const ctx = await requireAnyPermission(...TECH_PACK_READ);
    const pdf = await digitizingBrief(
      ctx,
      await requireProjectTechPack(ctx, projectId),
      logoId,
      await getRequestMeta(),
    );
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
