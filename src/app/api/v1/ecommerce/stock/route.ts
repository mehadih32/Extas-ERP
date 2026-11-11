import { listStock } from "@/modules/ecommerce/catalog.service";
import { retailStoreOf } from "@/modules/ecommerce/retail-mode";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/**
 * GET /api/v1/ecommerce/stock?updatedSince=&cursor=&warehouseId=&limit=: A-grade stock per SKU
 * per warehouse, and B-grade stock too for a retail store offered B-grade pieces (its rows say
 * grade "B").
 */
export const GET = ecommerceRoute(async (call) => {
  const store = await retailStoreOf(call);
  return listStock(call.ctx, call.query, {
    bGrade: Boolean(store?.sellsBGrade),
    bGradeSince: store?.updatedAt,
  });
});
