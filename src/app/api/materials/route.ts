import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as materials from "@/modules/materials/material.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/materials?kind=&supplierId=&warehouseId=&lowStock=&inStock=&includeInactive=&search=
 * &cursor=&take= — raw materials with stock on hand, reorder alerts and quantities still on order.
 * Average cost and value need materials.purchase, production.manage or accounts.view.
 */
export const GET = apiRoute(async (request) =>
  materials.listMaterials(
    await requirePermission("materials.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/materials — { name, kind: "FABRIC" | "TRIM" | "ACCESSORY" | "PACKAGING" | "OTHER",
 * unit, code? (default FAB-0001...), color?, specification?, reorderLevel?, supplierId?, notes? }.
 * Needs materials.manage or materials.purchase.
 */
export const POST = apiRoute(
  async (request) =>
    materials.createMaterial(
      await requireAnyPermission("materials.manage", "materials.purchase"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
