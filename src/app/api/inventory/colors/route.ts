import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/colors — Colors (matrix rows). */
export const GET = apiRoute(async () =>
  catalog.listColors(await requirePermission("inventory.view")),
);

/** POST /api/inventory/colors */
export const POST = apiRoute(
  async (request) =>
    catalog.createColor(
      await requirePermission("inventory.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
