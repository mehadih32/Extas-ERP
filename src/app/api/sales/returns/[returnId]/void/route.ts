import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as salesReturns from "@/modules/sales/return.service";

type Params = { returnId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/returns/:returnId/void — { reason }. Voids a return recorded by mistake
 * (accounts.receipts.record) while the buyer has not used its credit: the credit, the pieces in
 * Damage & QC Rejects and the order's status are put back.
 */
export const POST = apiRoute<Params>(async (request, { returnId }) =>
  salesReturns.voidSalesReturn(
    await requirePermission("accounts.receipts.record"),
    returnId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
