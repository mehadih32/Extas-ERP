import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as orders from "@/modules/sales/order.service";

type Params = { orderId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/orders/:orderId/logistics — { totalCartons?: 12 | null, packedById?: id | null }:
 * how many cartons the order goes in and which employee packed it, printed on the packing list
 * and the delivery challan. A field left out stays as it is.
 */
export const POST = apiRoute<Params>(async (request, { orderId }) =>
  orders.setOrderLogistics(
    await requirePermission("sales.order.create"),
    orderId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
