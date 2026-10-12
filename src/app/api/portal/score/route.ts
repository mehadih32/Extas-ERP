import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as scores from "@/modules/hr/score.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/score — your performance score (0 to 10) over the last 30 days, its parts and
 * what lost points, and how long you have been with the company.
 */
export const GET = apiRoute(async () => scores.myScore(await requirePermission("portal.self")));
