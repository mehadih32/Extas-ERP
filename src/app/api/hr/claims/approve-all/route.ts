import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as claims from "@/modules/hr/claims.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/claims/approve-all — { month }: approves the month's waiting claims that have
 * no flag, as claimed (expenses.manage or accounts.payments.record).
 */
export const POST = apiRoute(async (request) =>
  claims.approveAllClaims(
    await requireAnyPermission("expenses.manage", "accounts.payments.record"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
