import { apiErrorResponse, apiRoute } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany, requirePermission } from "@/modules/auth/context";
import * as logos from "@/modules/companies/logo.service";
import { fileFromRequest } from "@/modules/files/file.service";

export const dynamic = "force-dynamic";

/** GET /api/company/logo — the letterhead logo image (404 when there is none). */
export async function GET() {
  try {
    return fileResponse(await logos.getCompanyLogo(await requireCompany()), "inline");
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * POST /api/company/logo — multipart/form-data with a `file` field: the letterhead logo, a PNG
 * or JPG of up to 2 MB and 3000 pixels a side. Replaces the current logo.
 */
export const POST = apiRoute(
  async (request) => {
    const ctx = await requirePermission("company.settings");
    return logos.uploadCompanyLogo(ctx, await fileFromRequest(request), await getRequestMeta());
  },
  { successStatus: 201 },
);

/** DELETE /api/company/logo — takes the logo off the letterhead. */
export const DELETE = apiRoute(async () =>
  logos.removeCompanyLogo(await requirePermission("company.settings"), await getRequestMeta()),
);
