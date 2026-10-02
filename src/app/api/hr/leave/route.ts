import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as leave from "@/modules/hr/leave.service";

export const dynamic = "force-dynamic";

/** GET /api/hr/leave?status=&employeeId=&leaveTypeId=&from=&to=&cursor=&take= — leave requests. */
export const GET = apiRoute(async (request) =>
  leave.listLeaveRequests(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/hr/leave — { employeeId, leaveTypeId, startDate, endDate?, halfDay?, reason?,
 * attachmentId?, approve? }: HR records leave (approved at once with approve: true).
 */
export const POST = apiRoute(
  async (request) =>
    leave.createLeave(
      await requirePermission("hr.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
