import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as settings from "@/modules/hr/settings.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/leave-types?includeInactive= — Casual, Sick, Earned, Maternity, Unpaid and your own.
 */
export const GET = apiRoute(async (request) =>
  settings.listLeaveTypes(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll", "portal.self"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/** POST /api/hr/leave-types — { name, daysPerYear, isPaid?, prorate? }. */
export const POST = apiRoute(
  async (request) =>
    settings.createLeaveType(
      await requirePermission("hr.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
