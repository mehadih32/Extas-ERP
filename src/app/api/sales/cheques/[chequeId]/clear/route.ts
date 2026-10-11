import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as cheques from "@/modules/sales/cheque.service";

type Params = { chequeId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/cheques/:chequeId/clear — { clearedOn?, accountId? }: the bank paid it.
 * Records the money receipt into the bank account (the main bank by default) on that day.
 */
export const POST = apiRoute<Params>(async (request, { chequeId }) =>
  cheques.clearCheque(
    await requirePermission("accounts.receipts.record"),
    chequeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
