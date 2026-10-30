import { EcommerceApiError } from "@/modules/ecommerce/errors";
import { retailStoreOf } from "@/modules/ecommerce/retail-mode";
import { returnsSince } from "@/modules/ecommerce/retail-returns";
import { recordShopReturn } from "@/modules/ecommerce/returns";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** POST /api/v1/ecommerce/returns: pieces back from a delivered order, with QC per item (201). */
export const POST = ecommerceRoute(recordShopReturn, { successStatus: 201 });

/**
 * GET /api/v1/ecommerce/returns?updatedSince=&limit=: a retail store's returned
 * parcels and the owner's decisions on each piece (plan v6 sec 8.6).
 */
export const GET = ecommerceRoute(async (call) => {
  const store = await retailStoreOf(call);
  if (!store) {
    throw new EcommerceApiError(404, "NOT_FOUND", "This shop is not a retail store in the ERP.");
  }
  return returnsSince(call, store, call.query);
});
