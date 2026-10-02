import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/employees/:employeeId/salary — { amount, effectiveFrom, reason? }: a new monthly
 * salary from a day onwards.
 */
export const POST = apiRoute<Params>(
  async (request, { employeeId }) =>
    employees.reviseSalary(
      await requirePermission("hr.manage"),
      employeeId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
