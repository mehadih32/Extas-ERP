import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as payments from "@/modules/accounts/supplier-payment.service";

type Params = { paymentId: string };

export const dynamic = "force-dynamic";

/** GET /api/accounts/supplier-payments/:paymentId — the payment and what the supplier is owed now. */
export const GET = apiRoute<Params>(async (_request, { paymentId }) =>
  payments.getSupplierPayment(
    await requireAnyPermission("accounts.view", "accounts.payments.record"),
    paymentId,
  ),
);
