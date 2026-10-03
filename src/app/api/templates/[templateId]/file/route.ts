import { apiErrorResponse, apiRoute } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { fileFromRequest } from "@/modules/files/file.service";
import * as templates from "@/modules/templates/template.service";

type Params = { templateId: string };

export const dynamic = "force-dynamic";

/** GET /api/templates/:templateId/file — the uploaded template file, to check or edit it. */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  try {
    const { templateId } = await context.params;
    const file = await templates.downloadTemplateSource(
      await requirePermission("templates.manage"),
      templateId,
    );
    return fileResponse(file);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * POST /api/templates/:templateId/file — multipart/form-data with `file`: a new version of the
 * template (same kind). Tags still in it keep their mapping.
 */
export const POST = apiRoute<Params>(async (request, { templateId }) => {
  const ctx = await requirePermission("templates.manage");
  return templates.replaceTemplateFile(
    ctx,
    templateId,
    await fileFromRequest(request),
    await getRequestMeta(),
  );
});
