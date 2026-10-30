import { EcommerceApiError } from "@/modules/ecommerce/errors";
import { retailStoreOf } from "@/modules/ecommerce/retail-mode";
import { listExchanges } from "@/modules/ecommerce/retail-returns";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/**
 * GET /api/v1/ecommerce/exchanges?status=pending|all&updatedSince=&limit=: a
 * retail store's exchanges, what is still at risk and every money step (plan v6 sec 8.9).
 */
export const GET = ecommerceRoute(async (call) => {
  const store = await retailStoreOf(call);
  if (!store) {
    throw new EcommerceApiError(404, "NOT_FOUND", "This shop is not a retail store in the ERP.");
  }
  return listExchanges(call, store, call.query);
});
