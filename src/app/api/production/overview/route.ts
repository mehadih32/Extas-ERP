import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as projects from "@/modules/production/project.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/overview — the Production dashboard: counts (active, overdue,
 * due soon, finished this month), projects per stage, and one card per open project
 * with its stage badge and elapsed / remaining days (overdue cards first).
 */
export const GET = apiRoute(async () =>
  projects.getProductionOverview(await requirePermission("production.view")),
);
