import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as exits from "@/modules/hr/exit.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees/:employeeId/clearance — the clearance check before someone leaves: items
 * still out, salary, advances and claims either way, their login and certificates made.
 */
export const GET = apiRoute<Params>(async (_request, { employeeId }) =>
  exits.getClearance(await requirePermission("hr.manage"), employeeId),
);
