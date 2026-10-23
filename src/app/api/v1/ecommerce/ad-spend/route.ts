import { recordAdSpend } from "@/modules/ecommerce/ad-spend";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** POST /api/v1/ecommerce/ad-spend: a day's ad spend (201 new, 200 when it replaced that day's figure). */
export const POST = ecommerceRoute(recordAdSpend);
