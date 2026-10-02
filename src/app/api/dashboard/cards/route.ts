import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import { getMetricCards } from "@/modules/dashboard/cards.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/cards — the owner's metric cards: stock value, fixed assets, loans and
 * investors, today's sales and this month's net profit, each with the figures behind it and
 * whether the person chose to hide it (the eye icon).
 */
export const GET = apiRoute(async () =>
  getMetricCards(await requireAnyPermission("dashboard.financials", "accounts.view")),
);
