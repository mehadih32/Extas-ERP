import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { runId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/payroll/:runId/recalculate — picks up later attendance, leave, salary and advance
 * changes (keeps the edits).
 */
export const POST = apiRoute<Params>(async (_request, { runId }) =>
  payroll.recalculatePayrollRun(
    await requirePermission("hr.payroll"),
    runId,
    await getRequestMeta(),
  ),
);
