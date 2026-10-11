import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import { getPredictiveInsights } from "@/modules/dashboard/predictive.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/predictive?range=TODAY|WEEK|MONTH — the Home screen's predictive
 * insights: the top selling styles of the last 30 days with how many days their stock
 * lasts at that speed (for people who see stock), and the period's top buyer with what
 * they bought (for people who see sales amounts). Parts the person may not see come back
 * as null.
 */
export const GET = apiRoute(async (request) => {
  const ctx = await requireCompany();
  const range = new URL(request.url).searchParams.get("range") ?? undefined;
  return getPredictiveInsights(ctx, { range });
});
