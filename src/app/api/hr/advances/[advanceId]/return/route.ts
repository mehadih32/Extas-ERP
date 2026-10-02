import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as advances from "@/modules/hr/advance.service";

type Params = { advanceId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/advances/:advanceId/return — { amount, method?, accountId?, date?, reference?, note?
 * }: the employee gives back unspent money.
 */
export const POST = apiRoute<Params>(async (request, { advanceId }) =>
  advances.returnAdvance(
    await requirePermission("accounts.receipts.record"),
    advanceId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
