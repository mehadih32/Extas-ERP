import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as money from "@/modules/hr/money.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/money?range=week|month|6m|year|all|custom&from=&to= — the staff money totals
 * (salary, conveyance, bonus, overtime) for the period and who got each (hr.money.view).
 */
export const GET = apiRoute(async (request) =>
  money.getMoneySummary(
    await requirePermission("hr.money.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
