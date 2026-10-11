import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as payments from "@/modules/sales/payment.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/payments?partyId=&orderId=&from=&to=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  payments.listPayments(
    await requirePermission("sales.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/sales/payments — { orderId | proformaId | partyId, amount, method, accountId?, reference?,
 * proofFileId? }. On account, allocations [{ orderId, amount }] or oldestFirst pay the buyer's
 * invoices and the rest stays as advance balance; on an invoiced order, extra ADVANCE |
 * OLDER_DUES takes money above its due onto the buyer's account.
 * Accounts / Super Admin only (accounts.receipts.record).
 */
export const POST = apiRoute(
  async (request) =>
    payments.receivePayment(
      await requirePermission("accounts.receipts.record"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
