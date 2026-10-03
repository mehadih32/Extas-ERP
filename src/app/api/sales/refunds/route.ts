import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as refunds from "@/modules/sales/refund.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/refunds?partyId=&orderId=&proformaId=&kind=&from=&to=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  refunds.listRefunds(
    await requirePermission("sales.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/sales/refunds — { orderId | proformaId | partyId, amount, kind, reason, method?,
 * accountId?, refundDate?, reference?, notes? }. Takes money a buyer paid back off an order or
 * proforma (no live invoice) or their account credit: CASH pays it back
 * (accounts.payments.record), CREDIT keeps it on their account (accounts.receipts.record),
 * FORFEIT keeps it as a cancellation charge (accounts.manage).
 */
export const POST = apiRoute(
  async (request) =>
    refunds.refundBuyer(
      await requireAnyPermission(
        "accounts.payments.record",
        "accounts.receipts.record",
        "accounts.manage",
      ),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
