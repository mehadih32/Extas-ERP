import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as materials from "@/modules/materials/material.service";

type Params = { materialId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/materials/:materialId/stock-card?warehouseId=&from=&to= — every movement in date order
 * with the running balance, after the balance brought forward. With a store, quantities only.
 */
export const GET = apiRoute<Params>(async (request, { materialId }) =>
  materials.getStockCard(
    await requirePermission("materials.view"),
    materialId,
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
