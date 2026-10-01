import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as stock from "@/modules/inventory/stock.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/stock/summary — stock value, low / highest / slow stock, top sellers. */
export const GET = apiRoute(async () =>
  stock.getStockSummary(await requirePermission("inventory.view")),
);
