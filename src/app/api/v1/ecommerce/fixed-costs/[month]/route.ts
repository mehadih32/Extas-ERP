import { requireRetailStore } from "@/modules/ecommerce/retail-mode";
import { ecommerceRoute } from "@/modules/ecommerce/route";
import { putFixedCosts } from "@/modules/retail/summaries.service";

/**
 * PUT /api/v1/ecommerce/fixed-costs/{month}: a retail store's salary, rent,
 * utilities and other fixed costs for a month; sending again adds a version.
 */
export const PUT = ecommerceRoute<{ month: string }>(async (call, { month }) =>
  putFixedCosts(call.ctx, await requireRetailStore(call), month, call.body),
);
