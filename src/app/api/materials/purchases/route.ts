import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as purchases from "@/modules/materials/purchase.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/materials/purchases?supplierId=&purchaseOrderId=&materialId=&warehouseId=&status=&from=
 * &to=&cursor=&take= — supplier bills for raw materials. Needs materials.purchase,
 * production.manage or accounts.view as well.
 */
export const GET = apiRoute(async (request) =>
  purchases.listPurchases(
    await requirePermission("materials.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/materials/purchases — the supplier's bill, receiving the goods into a store:
 * { supplierId? (or purchaseOrderId), purchaseOrderId?, warehouseId?, billDate?, supplierRef?,
 *   paymentType: "DUE" | "CASH_BANK", method?, accountId?, reference?,
 *   items: [{ purchaseOrderLineId?, materialId?, quantity, unitPrice?, description? }], notes?,
 *   attachmentId? }.
 * Due: materials.purchase. Paid now in cash or bank: accounts.payments.record.
 */
export const POST = apiRoute(
  async (request) =>
    purchases.createPurchase(
      await requireAnyPermission("materials.purchase", "accounts.payments.record"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
