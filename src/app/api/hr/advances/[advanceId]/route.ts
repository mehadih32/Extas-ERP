import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as advances from "@/modules/hr/advance.service";

type Params = { advanceId: string };

export const dynamic = "force-dynamic";

/** GET /api/hr/advances/:advanceId — with how it was recovered. */
export const GET = apiRoute<Params>(async (_request, { advanceId }) =>
  advances.getAdvance(
    await requireAnyPermission(
      "hr.manage",
      "hr.payroll",
      "accounts.view",
      "accounts.payments.record",
    ),
    advanceId,
  ),
);

/** PATCH /api/hr/advances/:advanceId — { installmentAmount?, recoverFrom?, purpose? }. */
export const PATCH = apiRoute<Params>(async (request, { advanceId }) =>
  advances.updateAdvance(
    await requireAnyPermission("accounts.payments.record", "hr.payroll"),
    advanceId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
