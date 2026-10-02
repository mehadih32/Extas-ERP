import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as orders from "@/modules/materials/purchase-order.service";

type Params = { orderId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/materials/purchase-orders/:orderId/close — { reason }. A partly received order whose
 * rest will not come. Needs materials.purchase.
 */
export const POST = apiRoute<Params>(async (request, { orderId }) =>
  orders.closePurchaseOrder(
    await requirePermission("materials.purchase"),
    orderId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
