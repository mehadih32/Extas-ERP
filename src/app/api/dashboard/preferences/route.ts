import { apiRoute, readJson } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import {
  getDashboardPreferences,
  updateDashboardPreferences,
} from "@/modules/dashboard/preferences.service";

export const dynamic = "force-dynamic";

/** GET /api/dashboard/preferences — the metric cards this person keeps hidden. */
export const GET = apiRoute(async () => getDashboardPreferences(await requireCompany()));

/**
 * PATCH /api/dashboard/preferences — { metric, hidden } to hide or show one card, or
 * { hiddenMetrics: [...] } to replace the list.
 */
export const PATCH = apiRoute(async (request) =>
  updateDashboardPreferences(await requireCompany(), await readJson(request)),
);
