import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as stock from "@/modules/inventory/stock.service";

/** POST /api/inventory/stock/bad-stock — move pieces to Bad Stock (inventory loss). */
export const POST = apiRoute(
  async (request) =>
    stock.moveToBadStock(
      await requirePermission("inventory.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
