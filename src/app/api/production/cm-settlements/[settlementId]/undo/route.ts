import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as batchMoney from "@/modules/production/batch-money.service";

type Params = { settlementId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/cm-settlements/:settlementId/undo — { reason }: undoes a final CM
 * settlement; the faults it took off are open again (production.manage or
 * accounts.payments.record).
 */
export const POST = apiRoute<Params>(async (request, { settlementId }) =>
  batchMoney.undoCmSettlement(
    await requireAnyPermission("production.manage", "accounts.payments.record"),
    settlementId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
