import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/accounts/reports.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/reports/trial-balance?asOf=YYYY-MM-DD — every account's balance. */
export const GET = apiRoute(async (request) =>
  reports.getTrialBalance(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
