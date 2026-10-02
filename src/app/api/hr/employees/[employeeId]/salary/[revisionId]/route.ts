import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";

type Params = { employeeId: string; revisionId: string };

export const dynamic = "force-dynamic";

/** DELETE /api/hr/employees/:employeeId/salary/:revisionId — a revision entered by mistake. */
export const DELETE = apiRoute<Params>(async (_request, { employeeId, revisionId }) =>
  employees.deleteSalaryRevision(
    await requirePermission("hr.manage"),
    employeeId,
    revisionId,
    await getRequestMeta(),
  ),
);
