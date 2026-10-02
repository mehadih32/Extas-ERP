import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { runId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/payroll/:runId/bonus — { percentOfSalary } or { amount }, employeeIds?: e.g. an Eid
 * bonus.
 */
export const POST = apiRoute<Params>(async (request, { runId }) =>
  payroll.setPayrollBonus(
    await requirePermission("hr.payroll"),
    runId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
