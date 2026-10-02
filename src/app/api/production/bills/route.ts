import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as costs from "@/modules/production/cost.service";

export const dynamic = "force-dynamic";

/** GET /api/production/bills?supplierId=&projectId=&status=&from=&to=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  costs.listBills(
    await requirePermission("production.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/production/bills — one supplier bill split across projects:
 * { supplierId, supplierRef?, billDate?, paymentType: "DUE" | "CASH_BANK", method?, accountId?,
 *   reference?, allocations: [{ projectId, expenseHeadId, amount, description? }], notes?,
 *   attachmentId? }.
 * Due bills: production.manage. Paid now in cash or bank: accounts.payments.record.
 */
export const POST = apiRoute(
  async (request) =>
    costs.createBill(
      await requireAnyPermission("production.manage", "accounts.payments.record"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
