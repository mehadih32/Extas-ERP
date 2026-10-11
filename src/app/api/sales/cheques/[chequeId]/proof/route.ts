import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as proofs from "@/modules/sales/proof.service";

type Params = { chequeId: string };

export const dynamic = "force-dynamic";

/** POST /api/sales/cheques/:chequeId/proof — { fileId } from POST /api/sales/payment-proofs. */
export const POST = apiRoute<Params>(async (request, { chequeId }) =>
  proofs.attachChequeProof(
    await requirePermission("accounts.receipts.record"),
    chequeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
