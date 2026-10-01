import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany, requirePermission } from "@/modules/auth/context";
import { getCompanyProfile, updateCompanyProfile } from "@/modules/companies/company.service";

export const dynamic = "force-dynamic";

/** GET /api/company — the active company's profile and letterhead details. */
export const GET = apiRoute(async () => getCompanyProfile(await requireCompany()));

/** PATCH /api/company — update the active company's profile. */
export const PATCH = apiRoute(async (request) => {
  const ctx = await requirePermission("company.settings");
  return updateCompanyProfile(ctx, await readJson(request), await getRequestMeta());
});
