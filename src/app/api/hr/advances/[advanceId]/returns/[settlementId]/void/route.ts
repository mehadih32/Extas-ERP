import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as advances from "@/modules/hr/advance.service";

type Params = { advanceId: string; settlementId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/advances/:advanceId/returns/:settlementId/void — { reason }: undoes a cash return.
 */
export const POST = apiRoute<Params>(async (request, { advanceId, settlementId }) =>
  advances.voidAdvanceReturn(
    await requirePermission("accounts.receipts.record"),
    advanceId,
    settlementId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
