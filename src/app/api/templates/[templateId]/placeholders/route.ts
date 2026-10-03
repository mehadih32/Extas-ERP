import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as templates from "@/modules/templates/template.service";

type Params = { templateId: string };

export const dynamic = "force-dynamic";

/**
 * PUT /api/templates/:templateId/placeholders — { placeholders: [{ tag, sourcePath?, format?
 * (upper | lower), page?, x?, y?, fontSize?, bold?, align?, width? }] }. Word / HTML: maps the
 * listed tags to data. PDF / image: replaces the placed tags (page and top-left x, y in points).
 */
export const PUT = apiRoute<Params>(async (request, { templateId }) =>
  templates.setPlaceholders(
    await requirePermission("templates.manage"),
    templateId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
