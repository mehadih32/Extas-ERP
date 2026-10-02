import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { paymentId: string };

export const dynamic = "force-dynamic";

/** POST /api/hr/payroll/payments/:paymentId/void — { reason }: those employees are unpaid again. */
export const POST = apiRoute<Params>(async (request, { paymentId }) =>
  payroll.voidPayrollPayment(
    await requirePermission("accounts.payments.record"),
    paymentId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
