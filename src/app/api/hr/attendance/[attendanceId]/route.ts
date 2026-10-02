import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as attendance from "@/modules/hr/attendance.service";

type Params = { attendanceId: string };

export const dynamic = "force-dynamic";

/** DELETE /api/hr/attendance/:attendanceId — clears a mark (the day counts as present again). */
export const DELETE = apiRoute<Params>(async (_request, { attendanceId }) =>
  attendance.clearAttendance(
    await requirePermission("hr.manage"),
    attendanceId,
    await getRequestMeta(),
  ),
);
