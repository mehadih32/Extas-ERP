import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as scores from "@/modules/hr/score.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees/:employeeId/score — the employee's performance score over the last 30
 * days, its parts and what lost points, and their tenure (hr.manage).
 */
export const GET = apiRoute<Params>(async (_request, { employeeId }) =>
  scores.employeeScore(await requirePermission("hr.manage"), employeeId),
);
