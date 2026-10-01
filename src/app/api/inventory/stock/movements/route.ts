import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as stock from "@/modules/inventory/stock.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/stock/movements?variantId=&styleId=&warehouseId=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  stock.listMovements(
    await requirePermission("inventory.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
