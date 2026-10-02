import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as costs from "@/modules/production/cost.service";

type Params = { billId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/bills/:billId/payments — { amount, method, accountId?, paymentDate?,
 * reference?, notes? }.
 * Pays the supplier (Accounts / Super Admin only: accounts.payments.record).
 */
export const POST = apiRoute<Params>(
  async (request, { billId }) =>
    costs.payBill(
      await requirePermission("accounts.payments.record"),
      billId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
