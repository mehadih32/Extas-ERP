import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as materials from "@/modules/materials/material.service";

type Params = { materialId: string };

export const dynamic = "force-dynamic";

/** GET /api/materials/:materialId — stock in each store and quantities still on order. */
export const GET = apiRoute<Params>(async (_request, { materialId }) =>
  materials.getMaterial(await requirePermission("materials.view"), materialId),
);

/**
 * PATCH /api/materials/:materialId — { name?, code?, kind?, unit? (only before any stock or
 * order), color?, specification?, reorderLevel?, supplierId?, notes?, isActive? }.
 * Archiving (isActive: false) needs no stock left and nothing still due on an open order.
 */
export const PATCH = apiRoute<Params>(async (request, { materialId }) =>
  materials.updateMaterial(
    await requireAnyPermission("materials.manage", "materials.purchase"),
    materialId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
