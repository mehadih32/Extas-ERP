import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as claims from "@/modules/hr/claims.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/claims/pay-back — { employeeId, method?, accountId?, reference?, date? }: pays
 * the employee back everything approved and still owed (accounts.payments.record).
 */
export const POST = apiRoute(
  async (request) =>
    claims.payBackClaims(
      await requirePermission("accounts.payments.record"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
