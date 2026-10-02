import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as leave from "@/modules/hr/leave.service";

type Params = { leaveId: string };

export const dynamic = "force-dynamic";

/** GET /api/hr/leave/:leaveId */
export const GET = apiRoute<Params>(async (_request, { leaveId }) =>
  leave.getLeaveRequest(await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"), leaveId),
);
