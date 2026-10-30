import { EcommerceApiError } from "@/modules/ecommerce/errors";
import { retailStoreOf } from "@/modules/ecommerce/retail-mode";
import { recordDelivery } from "@/modules/ecommerce/retail-returns";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/**
 * PUT /api/v1/ecommerce/orders/{externalOrderId}/delivery: a retail store's
 * courier result (delivered, partly delivered or returned), sent again
 * whenever the site's "Partial delivery" mark changes (plan v6 sec 8.2).
 */
export const PUT = ecommerceRoute<{ externalOrderId: string }>(
  async (call, { externalOrderId }) => {
    if (!(await retailStoreOf(call))) {
      throw new EcommerceApiError(
        404,
        "NOT_FOUND",
        "This shop is not a retail store in the ERP: send courier results with POST /shipments/{consignmentId}/events.",
      );
    }
    return recordDelivery(call, externalOrderId, call.body);
  },
);
