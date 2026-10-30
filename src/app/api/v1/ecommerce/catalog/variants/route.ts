import { listCatalogVariants, listStoreCatalog } from "@/modules/ecommerce/catalog.service";
import { retailStoreOf } from "@/modules/ecommerce/retail-mode";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/**
 * GET /api/v1/ecommerce/catalog/variants?updatedSince=&styleCode=&cursor=&limit=:
 * the SKUs, a page at a time. A retail store's shop sees only its own prices.
 */
export const GET = ecommerceRoute(async (call) => {
  const store = await retailStoreOf(call);
  return store
    ? listStoreCatalog(call.ctx, store, call.query)
    : listCatalogVariants(call.ctx, call.query);
});
