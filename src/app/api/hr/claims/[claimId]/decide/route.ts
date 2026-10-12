import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as claims from "@/modules/hr/claims.service";

type Params = { claimId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/claims/:claimId/decide — { decision: "APPROVE", amount?, reason?, costHeadId? }
 * (a reason when less than claimed is approved) or { decision: "REJECT", reason }
 * (expenses.manage or accounts.payments.record).
 */
export const POST = apiRoute<Params>(async (request, { claimId }) =>
  claims.decideClaim(
    await requireAnyPermission("expenses.manage", "accounts.payments.record"),
    claimId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
