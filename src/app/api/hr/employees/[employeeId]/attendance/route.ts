import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as attendance from "@/modules/hr/attendance.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees/:employeeId/attendance?month= — the month day by day, with payroll's
 * totals.
 */
export const GET = apiRoute<Params>(async (request, { employeeId }) =>
  attendance.getEmployeeAttendance(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"),
    employeeId,
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
