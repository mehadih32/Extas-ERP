import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as claims from "@/modules/hr/claims.service";

type Params = { claimId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/claims/:claimId/recheck — runs a waiting claim's checks again
 * (expenses.manage or accounts.payments.record).
 */
export const POST = apiRoute<Params>(async (_request, { claimId }) =>
  claims.recheckClaim(
    await requireAnyPermission("expenses.manage", "accounts.payments.record"),
    claimId,
  ),
);
