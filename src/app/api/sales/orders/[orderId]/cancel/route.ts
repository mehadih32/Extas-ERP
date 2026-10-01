import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as orders from "@/modules/sales/order.service";

type Params = { orderId: string };

export const dynamic = "force-dynamic";

/** POST /api/sales/orders/:orderId/cancel — { reason }; frees the reserved stock. */
export const POST = apiRoute<Params>(async (request, { orderId }) =>
  orders.cancelOrder(
    await requirePermission("sales.order.create"),
    orderId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
