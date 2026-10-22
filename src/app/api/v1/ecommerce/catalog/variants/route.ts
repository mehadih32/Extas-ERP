import { listCatalogVariants } from "@/modules/ecommerce/catalog.service";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** GET /api/v1/ecommerce/catalog/variants?updatedSince=&cursor=&limit=: the SKUs, a page at a time. */
export const GET = ecommerceRoute(({ ctx, query }) => listCatalogVariants(ctx, query));
