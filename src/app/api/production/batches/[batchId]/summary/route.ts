import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import { getBatchSummary } from "@/modules/production/batch-summary.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/summary — the batch's money story: each style's
 * pieces and cost, where the money went, the cost of a good piece against the target,
 * the penalties and deductions (the CM settlement and the fault log) and what reached
 * stock (production.manage or accounts.view).
 */
export const GET = apiRoute<Params>(async (_request, { batchId }) =>
  getBatchSummary(await requireAnyPermission("production.manage", "accounts.view"), batchId),
);
