import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { runId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/payroll/:runId/reopen — { reason }: reverses the entry (no live payments) and makes
 * it a draft again.
 */
export const POST = apiRoute<Params>(async (request, { runId }) =>
  payroll.reopenPayrollRun(
    await requirePermission("hr.payroll.approve"),
    runId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
