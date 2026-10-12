import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as overtime from "@/modules/hr/overtime.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/overtime?month=&status=&employeeId= — the month's shadow overtime: what the app
 * found at each check-out, what the location trail suggests, and HR's decisions (hr.manage).
 */
export const GET = apiRoute(async (request) =>
  overtime.getOvertimeLedger(
    await requirePermission("hr.manage"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
