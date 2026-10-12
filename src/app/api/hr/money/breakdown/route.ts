import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as money from "@/modules/hr/money.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/money/breakdown?kind=salary|conveyance|bonus|overtime&employeeId=&range=… — one
 * person's months or trips behind a total, newest first, with what each was for (hr.money.view).
 */
export const GET = apiRoute(async (request) =>
  money.getMoneyBreakdown(
    await requirePermission("hr.money.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
