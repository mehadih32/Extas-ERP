import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany } from "@/modules/auth/context";
import { setSalesTarget } from "@/modules/dashboard/home.service";

export const dynamic = "force-dynamic";

/**
 * PUT /api/dashboard/sales-target — { month: "2026-10", amount } sets the sales target for
 * a month (company.settings). Later months without their own target use it.
 */
export const PUT = apiRoute(async (request) =>
  setSalesTarget(await requireCompany(), await readJson(request), await getRequestMeta()),
);
