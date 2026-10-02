import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees/directory?search=&includeFormer= — names and codes for pickers
 * (e.g. the employee on a conveyance expense).
 */
export const GET = apiRoute(async (request) =>
  employees.employeeDirectory(
    await requireAnyPermission(
      "hr.view",
      "hr.manage",
      "hr.payroll",
      "expenses.create",
      "expenses.manage",
      "accounts.view",
      "accounts.payments.record",
    ),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
