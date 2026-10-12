import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { runId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/payroll/:runId/pay — { itemIds? | parts?: [{ itemId, amount }], method?, accountId?,
 * date?, reference?, sendToWallets? }: Accounts pays net salaries (everything still owed, chosen
 * lines, or part of a line) in one payment voucher; with sendToWallets (bKash, Nagad or Rocket, once
 * wallet payouts are connected) the money is sent to each person's wallet.
 */
export const POST = apiRoute<Params>(async (request, { runId }) =>
  payroll.payPayrollRun(
    await requirePermission("accounts.payments.record"),
    runId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
