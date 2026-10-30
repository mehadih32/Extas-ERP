import { requireRetailStore } from "@/modules/ecommerce/retail-mode";
import { returnClaims } from "@/modules/ecommerce/retail-returns";
import { ecommerceRoute } from "@/modules/ecommerce/route";

/**
 * GET /api/v1/ecommerce/returns/claims?from=&to=: parcels and pieces decided
 * missing or damaged on those days, with what a courier claim needs
 * (site-changes 2.5.4).
 */
export const GET = ecommerceRoute(async (call) =>
  returnClaims(call, await requireRetailStore(call), call.query),
);
