import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as stock from "@/modules/inventory/stock.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventory/stock/bad-stock?from=&to=&styleId=&cursor=&take= — bad stock entries,
 * newest first, with totals (costs and losses only for those who see the financials).
 */
export const GET = apiRoute(async (request) =>
  stock.listBadStock(
    await requirePermission("inventory.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

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
