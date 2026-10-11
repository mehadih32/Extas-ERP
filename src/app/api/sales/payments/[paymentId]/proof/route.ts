import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as proofs from "@/modules/sales/proof.service";

type Params = { paymentId: string };

export const dynamic = "force-dynamic";

/** POST /api/sales/payments/:paymentId/proof — { fileId } from POST /api/sales/payment-proofs. */
export const POST = apiRoute<Params>(async (request, { paymentId }) =>
  proofs.attachPaymentProof(
    await requirePermission("accounts.receipts.record"),
    paymentId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
