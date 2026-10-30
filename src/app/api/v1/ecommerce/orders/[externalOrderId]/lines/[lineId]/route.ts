import { updateStoreLine } from "@/modules/ecommerce/orders.service";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/**
 * PATCH /api/v1/ecommerce/orders/{externalOrderId}/lines/{lineId}: a retail
 * store's line whose Return stock piece failed the packing check: WAIT,
 * REPLACE (another SKU) or CANCEL (plan v6 sec 8.5).
 */
export const PATCH = ecommerceRoute<{ externalOrderId: string; lineId: string }>(
  async (call, { externalOrderId, lineId }) =>
    updateStoreLine(call, externalOrderId, lineId, call.body),
);
