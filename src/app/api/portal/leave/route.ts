import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as leave from "@/modules/hr/leave.service";

export const dynamic = "force-dynamic";

/** GET /api/portal/leave?year= — your balances and requests. */
export const GET = apiRoute(async (request) =>
  leave.myLeave(
    await requirePermission("portal.self"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/portal/leave — { leaveTypeId, startDate, endDate?, halfDay?, reason?, attachmentId? }:
 * asks HR for leave.
 */
export const POST = apiRoute(
  async (request) =>
    leave.requestMyLeave(
      await requirePermission("portal.self"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
