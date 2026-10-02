import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as leave from "@/modules/hr/leave.service";

type Params = { leaveId: string };

export const dynamic = "force-dynamic";

/** POST /api/portal/leave/:leaveId/cancel — { note? }: withdraws your waiting request. */
export const POST = apiRoute<Params>(async (request, { leaveId }) =>
  leave.cancelMyLeave(
    await requirePermission("portal.self"),
    leaveId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
