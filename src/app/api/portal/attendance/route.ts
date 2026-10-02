import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as attendance from "@/modules/hr/attendance.service";

export const dynamic = "force-dynamic";

/** GET /api/portal/attendance?month= — your month day by day. */
export const GET = apiRoute(async (request) =>
  attendance.myAttendance(
    await requirePermission("portal.self"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
