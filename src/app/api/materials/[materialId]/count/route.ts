import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as materials from "@/modules/materials/material.service";

type Params = { materialId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/materials/:materialId/count — { countedQuantity, warehouseId?, date?, note? }. Sets the
 * store's quantity to the count; the difference is a gain or loss at average cost.
 * Needs materials.manage.
 */
export const POST = apiRoute<Params>(
  async (request, { materialId }) =>
    materials.countStock(
      await requirePermission("materials.manage"),
      materialId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
