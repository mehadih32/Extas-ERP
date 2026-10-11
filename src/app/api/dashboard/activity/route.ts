import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import { getActivityFeed } from "@/modules/dashboard/activity.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/activity?limit=12 — the Home screen's live activity feed from the
 * audit trail, newest first: everyone's for audit.view, one's own for everyone else.
 * Amounts in each row's text come back as their own parts, for the page to hide.
 */
export const GET = apiRoute(async (request) => {
  const ctx = await requireCompany();
  const limit = new URL(request.url).searchParams.get("limit") ?? undefined;
  return getActivityFeed(ctx, { limit });
});
