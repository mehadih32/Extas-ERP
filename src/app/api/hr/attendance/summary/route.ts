import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as attendance from "@/modules/hr/attendance.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/attendance/summary?month=&employeeId= — day counts per employee (what payroll uses).
 */
export const GET = apiRoute(async (request) =>
  attendance.getAttendanceSummary(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
