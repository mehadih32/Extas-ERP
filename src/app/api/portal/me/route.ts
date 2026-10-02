import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as portal from "@/modules/hr/portal.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/me — your profile and pay details, leave balances, this month, advances,
 * payslips.
 */
export const GET = apiRoute(async () =>
  portal.getMyOverview(await requirePermission("portal.self")),
);
