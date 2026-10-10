import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as lots from "@/modules/inventory/lot.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/stock/lots?styleId=&warehouseId=&cursor=&take= — a style's inward batches. */
export const GET = apiRoute(async (request) =>
  lots.listLots(
    await requirePermission("inventory.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
