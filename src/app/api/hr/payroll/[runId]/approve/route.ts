import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { runId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/payroll/:runId/approve — { reasons?: { [itemId]: why the other deductions
 * are taken } }; posts the salaries to the books and recovers the advances.
 */
export const POST = apiRoute<Params>(async (request, { runId }) =>
  payroll.approvePayrollRun(
    await requirePermission("hr.payroll.approve"),
    runId,
    await getRequestMeta(),
    await readJson(request),
  ),
);
