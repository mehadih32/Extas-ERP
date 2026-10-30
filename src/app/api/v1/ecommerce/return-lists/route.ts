import { EcommerceApiError } from "@/modules/ecommerce/errors";
import { retailStoreOf } from "@/modules/ecommerce/retail-mode";
import { recordReturnList } from "@/modules/ecommerce/retail-returns";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/**
 * POST /api/v1/ecommerce/return-lists: a lot the courier handed back to a
 * retail store, one row per parcel in the answer (plan v6 sec 8.3).
 */
export const POST = ecommerceRoute(
  async (call) => {
    const store = await retailStoreOf(call);
    if (!store) {
      throw new EcommerceApiError(
        404,
        "NOT_FOUND",
        "This shop is not a retail store in the ERP: send returns with POST /returns.",
      );
    }
    return recordReturnList(call, store, call.body);
  },
  { successStatus: 201 },
);
