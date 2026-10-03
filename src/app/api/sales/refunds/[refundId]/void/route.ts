import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as refunds from "@/modules/sales/refund.service";

type Params = { refundId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/refunds/:refundId/void — { reason }. Reverses a refund recorded by mistake
 * (same Accounts permission as recording that kind); the money is held again where it came from.
 */
export const POST = apiRoute<Params>(async (request, { refundId }) =>
  refunds.voidRefund(
    await requireAnyPermission(
      "accounts.payments.record",
      "accounts.receipts.record",
      "accounts.manage",
    ),
    refundId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
