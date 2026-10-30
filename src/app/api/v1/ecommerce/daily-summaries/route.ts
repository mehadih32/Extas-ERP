import { requireRetailStore } from "@/modules/ecommerce/retail-mode";
import { ecommerceRoute } from "@/modules/ecommerce/route";
import { listDailySummaries } from "@/modules/retail/summaries.service";

/**
 * GET /api/v1/ecommerce/daily-summaries?from=&to=: the days the ERP has from a
 * retail store's site, and the days still missing (plan v6 sec 6).
 */
export const GET = ecommerceRoute(async (call) =>
  listDailySummaries(call.ctx, await requireRetailStore(call), {
    from: call.query.get("from") ?? undefined,
    to: call.query.get("to") ?? undefined,
  }),
);
