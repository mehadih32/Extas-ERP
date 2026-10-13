import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as costs from "@/modules/production/cost.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/batches/:batchId/costs — { expenseHeadId, amount, paymentType,
 * supplierId?, supplierRef?, date?, description?, method?, accountId?, reference?,
 * allowDuplicate?, split: "EQUAL" | "ONE", projectId? }: a batch cost (QC, travel...) by its
 * Cost Setup, on one style or split equally among the batch's open styles to the cent. Due
 * to a supplier it is one bill split across the styles (production.manage or
 * accounts.payments.record); paid now (Cash/Bank) needs accounts.payments.record.
 */
export const POST = apiRoute<Params>(
  async (request, { batchId }) =>
    costs.addBatchCost(
      await requireAnyPermission("production.manage", "accounts.payments.record"),
      batchId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
