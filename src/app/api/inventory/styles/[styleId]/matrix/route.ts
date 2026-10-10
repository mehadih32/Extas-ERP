import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as matrix from "@/modules/inventory/matrix.service";

type Params = { styleId: string };

export const dynamic = "force-dynamic";

/** GET /api/inventory/styles/:styleId/matrix?warehouseId= — color x size grid with live stock. */
export const GET = apiRoute<Params>(async (request, { styleId }) =>
  matrix.getStyleMatrix(await requirePermission("inventory.view"), styleId, {
    warehouseId: new URL(request.url).searchParams.get("warehouseId") ?? undefined,
  }),
);

/** POST /api/inventory/styles/:styleId/matrix — { colorIds, sizeIds } creates missing SKUs. */
export const POST = apiRoute<Params>(async (request, { styleId }) =>
  matrix.generateMatrix(
    await requirePermission("inventory.manage"),
    styleId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/**
 * PUT /api/inventory/styles/:styleId/matrix — { colorIds, sizeIds } sets the style's colours
 * and sizes: makes (or brings back) SKUs for new ones and takes unticked ones off, refusing
 * while any of those SKUs holds stock or is on an open order or delivery.
 */
export const PUT = apiRoute<Params>(async (request, { styleId }) =>
  matrix.setMatrix(
    await requirePermission("inventory.manage"),
    styleId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
