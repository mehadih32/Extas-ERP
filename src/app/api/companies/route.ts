import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePlatformSuperAdmin, requireSession } from "@/modules/auth/context";
import { listAccessibleCompanies } from "@/modules/companies/access";
import { createCompany } from "@/modules/companies/company.service";

export const dynamic = "force-dynamic";

/** GET /api/companies — companies the user can switch to. */
export const GET = apiRoute(async () => listAccessibleCompanies((await requireSession()).user));

/** POST /api/companies — platform owner creates a new company. */
export const POST = apiRoute(
  async (request) => {
    const { user } = await requirePlatformSuperAdmin();
    return createCompany({ userId: user.id }, await readJson(request), await getRequestMeta());
  },
  { successStatus: 201 },
);
