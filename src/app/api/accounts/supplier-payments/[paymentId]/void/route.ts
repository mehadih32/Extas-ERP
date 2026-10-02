import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payments from "@/modules/accounts/supplier-payment.service";

type Params = { paymentId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/supplier-payments/:paymentId/void — { reason }: reverses a payment made by
 * mistake; the supplier's bills are settled again without it.
 */
export const POST = apiRoute<Params>(async (request, { paymentId }) =>
  payments.voidSupplierPayment(
    await requirePermission("accounts.payments.record"),
    paymentId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
