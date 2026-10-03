import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany, requirePermission } from "@/modules/auth/context";
import { fileFromForm, formFields, formFromRequest } from "@/modules/files/file.service";
import * as templates from "@/modules/templates/template.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/templates?documentType=QUOTATION|PROFORMA_INVOICE|COMMERCIAL_INVOICE|DELIVERY_CHALLAN|
 * LETTERHEAD&active=1 — document templates, defaults first. Without templates.manage: the active
 * ones of the documents you may print.
 */
export const GET = apiRoute(async (request) =>
  templates.listTemplates(
    await requireCompany(),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/templates — multipart/form-data with `file` (a Word .docx, an HTML page, a PDF or a
 * JPG / PNG, 10 MB at most), `name`, `documentType` and `isDefault`; or JSON { name,
 * documentType, html, isDefault? } for an HTML template. Word and HTML tags are read at once.
 */
export const POST = apiRoute(
  async (request) => {
    const ctx = await requirePermission("templates.manage");
    const meta = await getRequestMeta();
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await formFromRequest(request);
      return templates.uploadTemplate(ctx, formFields(form), await fileFromForm(form), meta);
    }
    return templates.createHtmlTemplate(ctx, await readJson(request), meta);
  },
  { successStatus: 201 },
);
