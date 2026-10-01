import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/brands — Brands. */
export const GET = apiRoute(async () =>
  catalog.listBrands(await requirePermission("inventory.view")),
);

/** POST /api/inventory/brands */
export const POST = apiRoute(
  async (request) =>
    catalog.createBrand(
      await requirePermission("inventory.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
