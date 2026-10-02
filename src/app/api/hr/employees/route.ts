import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees?status=&current=&department=&search=&cursor=&take= — employees
 * (salaries only for HR managers, payroll and Accounts).
 */
export const GET = apiRoute(async (request) =>
  employees.listEmployees(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/hr/employees — { name, joinDate, salary, code?, designation?, department?, phone?,
 * whatsapp?, email?, nid?, address?, dateOfBirth?, bloodGroup?, emergencyContact?, overtimeRate?,
 * salaryMethod?, bankName?, bankAccountNumber?, walletNumber?, notes? }.
 */
export const POST = apiRoute(
  async (request) =>
    employees.createEmployee(
      await requirePermission("hr.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
