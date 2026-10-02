import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as costs from "@/modules/production/cost.service";

type Params = { billId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/bills/:billId/void — { reason }. Reverses the bill; money already paid
 * stays with the supplier as an advance. Refused once the cost has been moved to stock.
 */
export const POST = apiRoute<Params>(async (request, { billId }) =>
  costs.voidBill(
    await requireAnyPermission("production.manage", "accounts.manage"),
    billId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
