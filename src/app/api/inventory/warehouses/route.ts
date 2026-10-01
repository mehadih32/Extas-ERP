import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as stock from "@/modules/inventory/stock.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/warehouses */
export const GET = apiRoute(async () =>
  stock.listWarehouses(await requirePermission("inventory.view")),
);

/** POST /api/inventory/warehouses — { name, address?, isDefault? } */
export const POST = apiRoute(
  async (request) =>
    stock.createWarehouse(
      await requirePermission("inventory.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
