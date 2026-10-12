import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as exits from "@/modules/hr/exit.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/employees/:employeeId/deactivate — { exitDate (today or earlier), status: RESIGNED |
 * TERMINATED, reason? }: leaving in one go. Refused while they hold company items; records the last
 * working day, switches their login off and has the experience and clearance certificate made.
 */
export const POST = apiRoute<Params>(async (request, { employeeId }) =>
  exits.deactivateEmployee(
    await requirePermission("hr.manage"),
    employeeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
