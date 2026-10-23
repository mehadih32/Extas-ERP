import { recordShopPayment } from "@/modules/ecommerce/payments";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** POST /api/v1/ecommerce/payments: money the shop collected on one of its orders (201). */
export const POST = ecommerceRoute(recordShopPayment, { successStatus: 201 });
