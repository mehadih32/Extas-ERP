import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as orders from "@/modules/materials/purchase-order.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/materials/purchase-orders?supplierId=&projectId=&materialId=&status=&overdue=&search=
 * &from=&to=&cursor=&take= — orders with what has arrived and what is still due.
 * Prices need materials.purchase, production.manage or accounts.view.
 */
export const GET = apiRoute(async (request) =>
  orders.listPurchaseOrders(
    await requirePermission("materials.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/materials/purchase-orders — { supplierId, projectId?, orderDate?, expectedDate?,
 * supplierRef?, notes?, lines: [{ materialId, quantity, unitPrice, description? }] }.
 * No money moves until the goods arrive with the bill. Needs materials.purchase.
 */
export const POST = apiRoute(
  async (request) =>
    orders.createPurchaseOrder(
      await requirePermission("materials.purchase"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
