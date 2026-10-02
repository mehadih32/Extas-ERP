import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { runId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/payroll/:runId/pay — { itemIds?, method?, accountId?, date?, reference? }: Accounts
 * pays net salaries (everyone unpaid, or chosen lines) in one payment voucher.
 */
export const POST = apiRoute<Params>(async (request, { runId }) =>
  payroll.payPayrollRun(
    await requirePermission("accounts.payments.record"),
    runId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
