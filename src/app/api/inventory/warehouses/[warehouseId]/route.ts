import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as stock from "@/modules/inventory/stock.service";

type Params = { warehouseId: string };

/**
 * DELETE /api/inventory/warehouses/:warehouseId — { password }. Super Admin only;
 * refused while the warehouse holds stock or open work.
 */
export const DELETE = apiRoute<Params>(async (request, { warehouseId }) =>
  stock.deleteWarehouse(
    await requirePermission("inventory.manage"),
    warehouseId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
