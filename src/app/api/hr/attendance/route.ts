import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as attendance from "@/modules/hr/attendance.service";

export const dynamic = "force-dynamic";

/** GET /api/hr/attendance?date= — the day's register: everyone employed, their mark and leave. */
export const GET = apiRoute(async (request) =>
  attendance.getAttendanceDay(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/hr/attendance — { date, entries: [{ employeeId, status: PRESENT | LATE | HALF_DAY |
 * ABSENT, checkIn?, checkOut?, overtimeMinutes?, note? }] }. Unmarked working days count as
 * present.
 */
export const POST = apiRoute(async (request) =>
  attendance.markAttendance(
    await requirePermission("hr.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
