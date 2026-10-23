import { updateShopOrder } from "@/modules/ecommerce/orders.service";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** PATCH /api/v1/ecommerce/orders/{externalOrderId}: edits before packing and the status steps. */
export const PATCH = ecommerceRoute<{ externalOrderId: string }>((call, { externalOrderId }) =>
  updateShopOrder(call, externalOrderId, call.body),
);
