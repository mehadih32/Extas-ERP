import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as orders from "@/modules/sales/order.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/orders?status=&channel=&partyId=&search=&from=&to=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  orders.listOrders(
    await requirePermission("sales.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/sales/orders — checkout: { channel, partyId?, lines? | matrix?, discount?,
 * shippingCharge?, tax?, forceOverride?: { reason }, payment?, documents? }.
 * 409 INSUFFICIENT_STOCK means: show the Force Override warning. A `payment` also
 * needs accounts.receipts.record (Accounts / Super Admin).
 */
export const POST = apiRoute(
  async (request) =>
    orders.createOrder(
      await requirePermission("sales.order.create"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
