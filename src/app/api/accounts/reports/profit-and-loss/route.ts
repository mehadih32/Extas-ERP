import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/accounts/reports.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/reports/profit-and-loss?period=THIS_MONTH|LAST_MONTH|THIS_FINANCIAL_YEAR|
 * LAST_FINANCIAL_YEAR|ONE_WEEK|ONE_MONTH|ONE_YEAR|TODAY&from=&to=&byMonth=true — automatic P&L.
 */
export const GET = apiRoute(async (request) =>
  reports.getProfitAndLoss(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
