import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as credit from "@/modules/sales/credit.service";

type Params = { orderId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/orders/:orderId/credit — { amount }: puts the buyer's credit (advance
 * balance) against the order's live invoice. Posts nothing; voiding the invoice gives it
 * back. Accounts / Super Admin only (accounts.receipts.record).
 */
export const POST = apiRoute<Params>(async (request, { orderId }) =>
  credit.applyCredit(
    await requirePermission("accounts.receipts.record"),
    orderId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
