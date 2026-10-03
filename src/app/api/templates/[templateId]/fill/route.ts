import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany } from "@/modules/auth/context";
import * as templates from "@/modules/templates/template.service";

type Params = { templateId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/templates/:templateId/fill — { id (the quotation, proforma, invoice or challan),
 * partyId? (letters) }: fills the template and keeps the copy with the printed documents
 * (download it from /api/documents/:id/download). Needs the right to print that document.
 */
export const POST = apiRoute<Params>(
  async (request, { templateId }) =>
    templates.fillTemplate(
      await requireCompany(),
      templateId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
