import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as materials from "@/modules/materials/material.service";

type Params = { materialId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/materials/:materialId/transfer — { fromWarehouseId, toWarehouseId, quantity, date?,
 * note? }. Moves stock between stores; its value does not change. Needs materials.manage.
 */
export const POST = apiRoute<Params>(
  async (request, { materialId }) =>
    materials.transferStock(
      await requirePermission("materials.manage"),
      materialId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
