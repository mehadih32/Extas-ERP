import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as batchMoney from "@/modules/production/batch-money.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/cm-settlement — the final CM settlement with the
 * factory: the one saved, or the draft (each style's CM on its A, B, C and rejected pieces,
 * the factory's open faults to deduct, the C-grade CM, the advance taken and the final
 * payable, with and without the C-grade CM taken off) (production.manage or accounts.view).
 */
export const GET = apiRoute<Params>(async (_request, { batchId }) =>
  batchMoney.getCmSettlementScreen(
    await requireAnyPermission("production.manage", "accounts.view"),
    batchId,
  ),
);

/**
 * POST /api/production/batches/:batchId/cm-settlement — { deductCGrade, note? }: saves the
 * settlement (CMS-) and marks the faults it takes off deducted
 * (production.manage or accounts.payments.record).
 */
export const POST = apiRoute<Params>(
  async (request, { batchId }) =>
    batchMoney.settleCm(
      await requireAnyPermission("production.manage", "accounts.payments.record"),
      batchId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
