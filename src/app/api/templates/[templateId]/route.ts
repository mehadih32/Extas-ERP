import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany, requirePermission } from "@/modules/auth/context";
import * as templates from "@/modules/templates/template.service";

type Params = { templateId: string };

export const dynamic = "force-dynamic";

/** GET /api/templates/:templateId — the template with its tags, what each prints and where. */
export const GET = apiRoute<Params>(async (_request, { templateId }) =>
  templates.getTemplate(await requireCompany(), templateId),
);

/** PATCH /api/templates/:templateId — { name?, isDefault?, isActive?, html? (HTML templates) }. */
export const PATCH = apiRoute<Params>(async (request, { templateId }) =>
  templates.updateTemplate(
    await requirePermission("templates.manage"),
    templateId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/templates/:templateId — documents already filled from it are kept. */
export const DELETE = apiRoute<Params>(async (_request, { templateId }) =>
  templates.deleteTemplate(
    await requirePermission("templates.manage"),
    templateId,
    await getRequestMeta(),
  ),
);
