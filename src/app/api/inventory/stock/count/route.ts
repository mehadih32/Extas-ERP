import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as stock from "@/modules/inventory/stock.service";

/**
 * POST /api/inventory/stock/count — a stock count or opening stock for several SKUs at one
 * warehouse and grade:
 * - { mode: COUNT, warehouseId?, grade?, note?, lines: [{ variantId, counted, expected }] }
 * - { mode: OPENING, warehouseId?, grade?, unitCost?, note?, lines: [{ variantId, quantity }] }
 * A count is refused (409) when any SKU's stock moved since `expected` was read.
 */
export const POST = apiRoute(async (request) =>
  stock.recordStockCount(
    await requirePermission("inventory.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
