import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as advances from "@/modules/hr/advance.service";

type Params = { advanceId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/advances/:advanceId/void — { reason }: an advance recorded by mistake, before any
 * recovery.
 */
export const POST = apiRoute<Params>(async (request, { advanceId }) =>
  advances.voidAdvance(
    await requireAnyPermission("accounts.payments.record", "accounts.manage"),
    advanceId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
