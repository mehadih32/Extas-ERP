import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/categories — Category tree (with style counts). */
export const GET = apiRoute(async () =>
  catalog.listCategoryTree(await requirePermission("inventory.view")),
);

/** POST /api/inventory/categories */
export const POST = apiRoute(
  async (request) =>
    catalog.createCategory(
      await requirePermission("inventory.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
