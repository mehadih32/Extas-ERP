import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as leave from "@/modules/hr/leave.service";

type Params = { leaveId: string };

export const dynamic = "force-dynamic";

/** POST /api/hr/leave/:leaveId/reject — { note }. */
export const POST = apiRoute<Params>(async (request, { leaveId }) =>
  leave.rejectLeave(
    await requirePermission("hr.manage"),
    leaveId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
