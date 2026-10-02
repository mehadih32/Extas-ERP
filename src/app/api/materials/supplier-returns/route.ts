import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as returns from "@/modules/materials/supplier-return.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/materials/supplier-returns?supplierId=&billId=&includeVoid=&from=&to=&cursor=&take=
 * — goods sent back to suppliers (debit notes). Needs materials.purchase, production.manage or
 * accounts.view as well.
 */
export const GET = apiRoute(async (request) =>
  returns.listSupplierReturns(
    await requirePermission("materials.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/materials/supplier-returns — { billId, warehouseId?, date?, reason,
 * lines: [{ billItemId, quantity }] }. The goods go back at the bill price and the supplier owes
 * us that much. Needs materials.purchase or accounts.manage.
 */
export const POST = apiRoute(
  async (request) =>
    returns.createSupplierReturn(
      await requireAnyPermission("materials.purchase", "accounts.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
