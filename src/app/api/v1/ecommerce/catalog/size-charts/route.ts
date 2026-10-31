import { listSizeCharts } from "@/modules/ecommerce/catalog.service";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/**
 * GET /api/v1/ecommerce/catalog/size-charts?updatedSince=&styleCode=&cursor=&limit=:
 * each style's size chart (values by size name, "inch" or "cm"), a page at a time.
 */
export const GET = ecommerceRoute(async (call) => listSizeCharts(call.ctx, call.query));
