import { EcommerceApiError } from "@/modules/ecommerce/errors";
import { retailStoreOf } from "@/modules/ecommerce/retail-mode";
import { ecommerceRoute } from "@/modules/ecommerce/route";
import { accountOf } from "@/modules/retail/account.service";

/**
 * GET /api/v1/ecommerce/account?from=&to=: what a retail store owes the ERP,
 * its 30-day hold and, for a period, its bills, credits and payments (plan v6 sec 5).
 */
export const GET = ecommerceRoute(async (call) => {
  const store = await retailStoreOf(call);
  if (!store) {
    throw new EcommerceApiError(
      404,
      "NOT_FOUND",
      "This shop is not a retail store in the ERP, so it has no account here.",
    );
  }
  return accountOf(call.ctx, store, {
    from: call.query.get("from") ?? undefined,
    to: call.query.get("to") ?? undefined,
  });
});
