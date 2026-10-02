import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { runId: string };

export const dynamic = "force-dynamic";

/** GET /api/hr/payroll/:runId — every employee's line, totals and payments. */
export const GET = apiRoute<Params>(async (_request, { runId }) =>
  payroll.getPayrollRun(
    await requireAnyPermission("hr.manage", "hr.payroll", "accounts.view"),
    runId,
  ),
);

/** DELETE /api/hr/payroll/:runId — a draft only. */
export const DELETE = apiRoute<Params>(async (_request, { runId }) =>
  payroll.deletePayrollRun(await requirePermission("hr.payroll"), runId, await getRequestMeta()),
);
