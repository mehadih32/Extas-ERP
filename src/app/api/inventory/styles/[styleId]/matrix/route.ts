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
