import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees/:employeeId — the 360° profile (leave, this month's attendance; salary
 * history, advances and payslips for HR managers, payroll and Accounts).
 */
export const GET = apiRoute<Params>(async (_request, { employeeId }) =>
  employees.getEmployee(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"),
    employeeId,
  ),
);

/**
 * PATCH /api/hr/employees/:employeeId — profile details, joining day, status (ACTIVE | ON_LEAVE).
 */
export const PATCH = apiRoute<Params>(async (request, { employeeId }) =>
  employees.updateEmployee(
    await requirePermission("hr.manage"),
    employeeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/hr/employees/:employeeId — only someone added by mistake (no records). */
export const DELETE = apiRoute<Params>(async (_request, { employeeId }) =>
  employees.deleteEmployee(
    await requirePermission("hr.manage"),
    employeeId,
    await getRequestMeta(),
  ),
);
