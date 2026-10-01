import { z } from "zod";

import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireSession } from "@/modules/auth/context";
import { switchCompany } from "@/modules/companies/company.service";

const bodySchema = z.object({ companyId: z.string().min(1) });

/** POST /api/auth/switch-company — { companyId } → makes it the active company. */
export const POST = apiRoute(async (request) => {
  const { companyId } = bodySchema.parse(await readJson(request));
  return switchCompany(await requireSession(), companyId, await getRequestMeta());
});
