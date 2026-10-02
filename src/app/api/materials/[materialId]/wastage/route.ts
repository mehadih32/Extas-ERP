import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as materials from "@/modules/materials/material.service";

type Params = { materialId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/materials/:materialId/wastage — { quantity, reason, warehouseId?, date? }. Damaged or
 * spoilt stock, booked at average cost as a loss. Needs materials.manage.
 */
export const POST = apiRoute<Params>(
  async (request, { materialId }) =>
    materials.recordWastage(
      await requirePermission("materials.manage"),
      materialId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
