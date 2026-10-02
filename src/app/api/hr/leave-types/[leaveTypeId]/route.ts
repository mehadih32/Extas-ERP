import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as settings from "@/modules/hr/settings.service";

type Params = { leaveTypeId: string };

export const dynamic = "force-dynamic";

/**
 * PATCH /api/hr/leave-types/:leaveTypeId — { name?, daysPerYear?, isPaid?, prorate?, isActive? }.
 */
export const PATCH = apiRoute<Params>(async (request, { leaveTypeId }) =>
  settings.updateLeaveType(
    await requirePermission("hr.manage"),
    leaveTypeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
