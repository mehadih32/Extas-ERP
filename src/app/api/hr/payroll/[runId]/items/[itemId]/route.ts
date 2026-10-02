import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { runId: string; itemId: string };

export const dynamic = "force-dynamic";

/**
 * PATCH /api/hr/payroll/:runId/items/:itemId — { allowances?, bonus?, taxDeduction?,
 * otherDeductions?, overtimeHours?, advanceDeduction?, note? } on a draft (null puts overtime /
 * advance back to automatic).
 */
export const PATCH = apiRoute<Params>(async (request, { runId, itemId }) =>
  payroll.updatePayrollItem(
    await requirePermission("hr.payroll"),
    runId,
    itemId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
