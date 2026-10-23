import { recordShopReturn } from "@/modules/ecommerce/returns";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** POST /api/v1/ecommerce/returns: pieces back from a delivered order, with QC per item (201). */
export const POST = ecommerceRoute(recordShopReturn, { successStatus: 201 });
