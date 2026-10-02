import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees/:employeeId/statement?from=&to= — advances, salaries and payments in the
 * books.
 */
export const GET = apiRoute<Params>(async (request, { employeeId }) =>
  employees.getEmployeeStatement(
    await requireAnyPermission("hr.manage", "hr.payroll", "accounts.view"),
    employeeId,
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
