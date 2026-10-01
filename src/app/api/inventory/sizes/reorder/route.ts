import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";

/** POST /api/inventory/sizes/reorder — { sizeIds: [...] } in the new column order. */
export const POST = apiRoute(async (request) =>
  catalog.reorderSizes(
    await requirePermission("inventory.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
