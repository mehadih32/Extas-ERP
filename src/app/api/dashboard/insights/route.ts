import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import { getDashboardInsights } from "@/modules/dashboard/insights.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/insights?period=&from=&to=&limit=&groupBy=SKU|STYLE&sortBy=QUANTITY|REVENUE
 * &slowDays=&coverDays= — top sellers for a period (the past month by default), the SKUs
 * holding the most stock, dead and slow stock, and low stock. Money columns only for people
 * who may see them.
 */
export const GET = apiRoute(async (request) =>
  getDashboardInsights(
    await requireAnyPermission("dashboard.view", "inventory.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
