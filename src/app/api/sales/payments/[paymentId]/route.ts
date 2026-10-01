import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as payments from "@/modules/sales/payment.service";

type Params = { paymentId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/payments/:paymentId — money receipt. */
export const GET = apiRoute<Params>(async (_request, { paymentId }) =>
  payments.getPaymentReceipt(await requirePermission("sales.view"), paymentId),
);
