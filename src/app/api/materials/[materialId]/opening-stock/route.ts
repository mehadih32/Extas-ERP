import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as materials from "@/modules/materials/material.service";

type Params = { materialId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/materials/:materialId/opening-stock — { quantity, unitCost, warehouseId?, date?,
 * note? }. Stock held before the ERP: Dr Raw Materials / Cr Opening Balance Equity.
 * Needs materials.purchase or accounts.manage.
 */
export const POST = apiRoute<Params>(
  async (request, { materialId }) =>
    materials.addOpeningStock(
      await requireAnyPermission("materials.purchase", "accounts.manage"),
      materialId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
