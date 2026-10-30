import { requireRetailStore } from "@/modules/ecommerce/retail-mode";
import { ecommerceRoute } from "@/modules/ecommerce/route";
import { listFixedCosts } from "@/modules/retail/summaries.service";

/** GET /api/v1/ecommerce/fixed-costs?from=&to= (months): a retail store's fixed costs (plan v6 sec 6a). */
export const GET = ecommerceRoute(async (call) =>
  listFixedCosts(call.ctx, await requireRetailStore(call), {
    from: call.query.get("from") ?? undefined,
    to: call.query.get("to") ?? undefined,
  }),
);
