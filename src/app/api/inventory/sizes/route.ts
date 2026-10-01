import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/sizes — Sizes (matrix columns, in order). */
export const GET = apiRoute(async () =>
  catalog.listSizes(await requirePermission("inventory.view")),
);

/** POST /api/inventory/sizes */
export const POST = apiRoute(
  async (request) =>
    catalog.createSize(
      await requirePermission("inventory.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
