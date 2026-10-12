import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { paymentId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/payroll/payments/:paymentId/retry-payouts — { lineIds? }: sends the failed wallet
 * payouts of a salary payment again (all of them, or the lines named).
 */
export const POST = apiRoute<Params>(async (request, { paymentId }) =>
  payroll.retrySalaryPayouts(
    await requirePermission("accounts.payments.record"),
    paymentId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
