import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/employees/:employeeId/portal-access — { userId } or { email, phone? }: links a login
 * (a new one gets the Employee role and a temporary password, returned once).
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
