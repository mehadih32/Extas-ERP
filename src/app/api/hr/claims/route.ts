import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as claims from "@/modules/hr/claims.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/claims?month=&status=&kind=&employeeId=&claim= — the month's staff claims
 * (conveyance and local material) with their checks and decisions, and what is owed to each
 * person (hr.manage, expenses.manage or accounts.payments.record).
 */
export const GET = apiRoute(async (request) =>
  claims.getClaimsLedger(
    await requireAnyPermission("hr.manage", "expenses.manage", "accounts.payments.record"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
