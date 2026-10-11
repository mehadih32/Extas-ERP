import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { fileFromForm, formFields, formFromRequest } from "@/modules/files/file.service";
import * as vault from "@/modules/hr/vault.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/profile/documents — multipart/form-data with `file` (a photo or a PDF, 10 MB at
 * most), `kind` (NID, PHOTO, CERTIFICATE or OTHER) and `title` (optional): keeps the paper in your
 * own data vault, where HR sees it.
 */
export const POST = apiRoute(
  async (request) => {
    const ctx = await requirePermission("portal.self");
    const form = await formFromRequest(request);
    return vault.addMyDocument(
      ctx,
      formFields(form),
      await fileFromForm(form),
      await getRequestMeta(),
    );
  },
  { successStatus: 201 },
);
