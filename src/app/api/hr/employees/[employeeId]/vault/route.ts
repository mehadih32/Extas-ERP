import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as vault from "@/modules/hr/vault.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees/:employeeId/vault — the data vault (hr.manage): what is missing, the
 * papers kept, the pay detail change waiting and the last ones decided.
 */
export const GET = apiRoute<Params>(async (_request, { employeeId }) =>
  vault.getEmployeeVault(await requirePermission("hr.manage"), employeeId),
);
