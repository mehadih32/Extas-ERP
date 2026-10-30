import { requireRetailStore } from "@/modules/ecommerce/retail-mode";
import { ecommerceRoute } from "@/modules/ecommerce/route";
import { putDailySummary } from "@/modules/retail/summaries.service";

/**
 * PUT /api/v1/ecommerce/daily-summaries/{date}: a retail store's totals for a
 * day that is over; sending the day again adds a version (plan v6 sec 6).
 */
export const PUT = ecommerceRoute<{ date: string }>(async (call, { date }) =>
  putDailySummary(call.ctx, await requireRetailStore(call), date, call.body),
);
