import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import { getProductionPipeline } from "@/modules/dashboard/pipeline.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/pipeline — the Home screen's production pipeline: the active
 * projects, the most pressing first, each with how far it is (its stage, or the share of
 * pieces received when that is further along) and the days left. Pieces and days only.
 */
export const GET = apiRoute(async () =>
  getProductionPipeline(
    await requireAnyPermission("production.view", "dashboard.financials", "accounts.view"),
  ),
);
