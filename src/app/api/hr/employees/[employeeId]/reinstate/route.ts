import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/** POST /api/hr/employees/:employeeId/reinstate — undoes a leaving record. */
export const POST = apiRoute<Params>(async (_request, { employeeId }) =>
  employees.reinstateEmployee(
    await requirePermission("hr.manage"),
    employeeId,
    await getRequestMeta(),
  ),
);
