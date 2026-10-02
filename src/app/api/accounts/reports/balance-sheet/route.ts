import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/accounts/reports.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/reports/balance-sheet?asOf=YYYY-MM-DD — assets, liabilities and equity. */
export const GET = apiRoute(async (request) =>
  reports.getBalanceSheet(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
