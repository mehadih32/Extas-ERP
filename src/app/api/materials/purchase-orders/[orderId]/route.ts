import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as orders from "@/modules/materials/purchase-order.service";

type Params = { orderId: string };

export const dynamic = "force-dynamic";

/** GET /api/materials/purchase-orders/:orderId — lines, what arrived, and the bills it came on. */
export const GET = apiRoute<Params>(async (_request, { orderId }) =>
  orders.getPurchaseOrder(await requirePermission("materials.view"), orderId),
);

/**
 * PATCH /api/materials/purchase-orders/:orderId — { projectId?, expectedDate?, supplierRef?,
 * notes?, lines? }. Lines can only be replaced while nothing has arrived. Needs materials.purchase.
 */
export const PATCH = apiRoute<Params>(async (request, { orderId }) =>
  orders.updatePurchaseOrder(
    await requirePermission("materials.purchase"),
    orderId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
