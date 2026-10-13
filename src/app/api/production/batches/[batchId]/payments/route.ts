import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as batchMoney from "@/modules/production/batch-money.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/payments — the advances paid for the batch and where
 * its final CM settlement stands (production.manage or accounts.view).
 */
export const GET = apiRoute<Params>(async (_request, { batchId }) =>
  batchMoney.getBatchMoney(
    await requireAnyPermission("production.manage", "accounts.view"),
    batchId,
  ),
);

/**
 * POST /api/production/batches/:batchId/payments — { supplierId?, amount, paymentDate?,
 * method?, accountId?, reference?, notes? }: pays the batch's factory (or another supplier)
 * for the batch, an advance on the CM. It settles the bills of the batch's styles first and
 * the rest stays on their ledger as an advance. Accessories suppliers are refused (their
 * running ledger) (accounts.payments.record).
 */
export const POST = apiRoute<Params>(
  async (request, { batchId }) =>
    batchMoney.payForBatch(
      await requirePermission("accounts.payments.record"),
      batchId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
