import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/employees/:employeeId/exit — { exitDate, status: RESIGNED | TERMINATED, reason? }.
 */
export const POST = apiRoute<Params>(async (request, { employeeId }) =>
  employees.exitEmployee(
    await requirePermission("hr.manage"),
    employeeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
