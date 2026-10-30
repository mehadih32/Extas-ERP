import { requireRetailStore } from "@/modules/ecommerce/retail-mode";
import { returnsSummary } from "@/modules/ecommerce/retail-returns";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/** GET /api/v1/ecommerce/returns/summary?date=: one day's returns, for the site's nightly compare. */
export const GET = ecommerceRoute(async (call) =>
  returnsSummary(call, await requireRetailStore(call), call.query),
);
