import { EcommerceApiError } from "@/modules/ecommerce/errors";
import { retailStoreOf } from "@/modules/ecommerce/retail-mode";
import { lateReturn } from "@/modules/ecommerce/retail-returns";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/**
 * POST /api/v1/ecommerce/exchanges/{exchangeId}/late-return: an exchange's old
 * piece came back on no matching consignment; it goes on Hold for the owner.
 */
export const POST = ecommerceRoute<{ exchangeId: string }>(
  async (call, { exchangeId }) => {
    const store = await retailStoreOf(call);
    if (!store) {
      throw new EcommerceApiError(404, "NOT_FOUND", "This shop is not a retail store in the ERP.");
    }
    return lateReturn(call, store, exchangeId, call.body);
  },
  { successStatus: 201 },
);
