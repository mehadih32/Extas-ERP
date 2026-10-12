import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as faults from "@/modules/production/fault.service";

type Params = { faultId: string };

export const dynamic = "force-dynamic";

/**
 * PATCH /api/production/faults/:faultId — { status: DEDUCTED | WAIVED | OPEN, note? }: marks
 * a fault taken off a payment or waived (with a note), or puts it back to open
 * (production.manage or accounts.payments.record).
 */
export const PATCH = apiRoute<Params>(async (request, { faultId }) =>
  faults.settleFault(
    await requireAnyPermission("production.manage", "accounts.payments.record"),
    faultId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
