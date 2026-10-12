import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as overtime from "@/modules/hr/overtime.service";

type Params = { entryId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/overtime/:entryId/decide — { decision: "APPROVE", minutes?, reason? } (a reason
 * when the minutes differ from those found) or { decision: "REJECT", reason } (hr.manage).
 */
export const POST = apiRoute<Params>(async (request, { entryId }) =>
  overtime.decideOvertime(
    await requirePermission("hr.manage"),
    entryId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
