import { listStock } from "@/modules/ecommerce/catalog.service";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** GET /api/v1/ecommerce/stock?updatedSince=&cursor=&warehouseId=&limit=: A-grade stock per SKU per warehouse. */
export const GET = ecommerceRoute(({ ctx, query }) => listStock(ctx, query));
