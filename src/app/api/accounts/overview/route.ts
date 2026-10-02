import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as reports from "@/modules/accounts/reports.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/overview — dashboard money cards: cash, stock value, fixed assets,
 * loans and investors, today's sales, profit, overdue installments, claims waiting.
 */
export const GET = apiRoute(async () =>
  reports.getAccountsOverview(await requireAnyPermission("accounts.view", "dashboard.financials")),
);
