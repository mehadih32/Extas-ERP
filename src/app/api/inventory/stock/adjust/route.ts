import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as stock from "@/modules/inventory/stock.service";

/** POST /api/inventory/stock/adjust — opening stock or +/- correction for one SKU. */
export const POST = apiRoute(async (request) =>
  stock.adjustStock(
    await requirePermission("inventory.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
