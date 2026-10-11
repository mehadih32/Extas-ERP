import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { fileFromRequest } from "@/modules/files/file.service";
import * as proofs from "@/modules/sales/proof.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/payment-proofs — multipart `file`: a proof photo (JPG, PNG or WebP,
 * 512 KB at most; the app makes photos about 100 KB before sending). Returns the file to
 * pass as proofFileId. A photo no payment or cheque uses is deleted the next night.
 */
export const POST = apiRoute(
  async (request) =>
    proofs.storePaymentProof(
      await requirePermission("accounts.receipts.record"),
      await fileFromRequest(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
