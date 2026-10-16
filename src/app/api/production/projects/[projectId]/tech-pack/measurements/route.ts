import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { requireProjectTechPack } from "@/modules/production/tech-pack-spec.service";
import { measurementsFile } from "@/modules/production/tech-pack-export";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/tech-pack/measurements?format=pdf|xlsx — the
 * style's measurement sheet: a PDF in the chart's unit, or an Excel workbook with a sheet
 * in inches and one in cm. Made for each request, never kept.
 * The address from before v6.4: the same file as /api/tech-packs/:techPackId/..., for
 * the style's tech pack (not found while it has none).
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { projectId } = await context.params;
    const ctx = await requirePermission("production.view");
    const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "pdf";
    const file = await measurementsFile(
      ctx,
      await requireProjectTechPack(ctx, projectId),
      format,
      await getRequestMeta(),
    );
    return fileResponse(file);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
