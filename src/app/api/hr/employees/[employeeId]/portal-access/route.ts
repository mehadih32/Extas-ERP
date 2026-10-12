import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";
import * as logins from "@/modules/hr/login.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/employees/:employeeId/portal-access — { userId } or { email, phone? }, and
 * { roleId } for people who manage users: links a login (a new one gets the Employee role, or the
 * one chosen, and a temporary password, returned once).
 */
export const POST = apiRoute<Params>(async (request, { employeeId }) =>
  employees.grantPortalAccess(
    await requirePermission("hr.manage"),
    employeeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/hr/employees/:employeeId/portal-access — unlinks the login. */
export const DELETE = apiRoute<Params>(async (_request, { employeeId }) =>
  employees.revokePortalAccess(
    await requirePermission("hr.manage"),
    employeeId,
    await getRequestMeta(),
  ),
);

/**
 * PATCH /api/hr/employees/:employeeId/portal-access — { roleId } moves the login to another role,
 * { active } switches it off or on for this company (company.members.manage, as Settings > Team).
 */
export const PATCH = apiRoute<Params>(async (request, { employeeId }) =>
  logins.changeEmployeeLogin(
    await requirePermission("company.members.manage"),
    employeeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
