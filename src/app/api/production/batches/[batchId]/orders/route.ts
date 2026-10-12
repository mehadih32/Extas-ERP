import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { createBatchOrders } from "@/modules/production/batch-orders.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/batches/:batchId/orders — { orders: [{ supplierId, expectedDate?,
 * supplierRef?, notes?, lines: [{ materialId, quantity, unitPrice?, imageId?,
 * description? }] }] }: one purchase order per supplier, each line shared out over the
 * styles, colours and sizes that need it; a line without a price is priced at receive.
 */
export const POST = apiRoute<Params>(async (request, { batchId }) =>
  createBatchOrders(
    await requirePermission("materials.purchase"),
    batchId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
