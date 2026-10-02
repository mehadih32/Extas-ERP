import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as leave from "@/modules/hr/leave.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/leave/balances?employeeId=&year= — allowance, taken, waiting and left per leave type.
 */
export const GET = apiRoute(async (request) =>
  leave.getLeaveBalances(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * PUT /api/hr/leave/balances — { employeeId, leaveTypeId, year, entitled, note? }: sets a year's
 * allowance (entitled: null goes back to the default).
 */
export const PUT = apiRoute(async (request) =>
  leave.adjustLeaveBalance(
    await requirePermission("hr.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
