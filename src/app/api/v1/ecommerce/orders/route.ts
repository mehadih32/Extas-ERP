import { createShopOrder } from "@/modules/ecommerce/orders.service";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** POST /api/v1/ecommerce/orders: the shop's order as a confirmed WEBSITE order, stock reserved. */
export const POST = ecommerceRoute((call) => createShopOrder(call, call.body), {
  successStatus: 201,
});
