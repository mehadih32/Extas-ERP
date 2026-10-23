import { stockOfSku } from "@/modules/ecommerce/catalog.service";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** GET /api/v1/ecommerce/stock/{sku}: live stock of one SKU, for the checkout's last check. */
export const GET = ecommerceRoute<{ sku: string }>((call, { sku }) => stockOfSku(call, sku));
