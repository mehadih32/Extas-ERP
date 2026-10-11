import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import { getHomePulse, getHomeTopBar } from "@/modules/dashboard/home.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/home?range=TODAY|WEEK|MONTH — the Home screen's top bar (pending tasks
 * today, the month's sales against its target) and The Pulse (sales and money collected,
 * deliveries, production) for the period. Parts the person may not see come back as null.
 */
export const GET = apiRoute(async (request) => {
  const ctx = await requireCompany();
  const range = new URL(request.url).searchParams.get("range") ?? undefined;
  const [topBar, pulse] = await Promise.all([getHomeTopBar(ctx), getHomePulse(ctx, { range })]);
  return { topBar, pulse };
});
