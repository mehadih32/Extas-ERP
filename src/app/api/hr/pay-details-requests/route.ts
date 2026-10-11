import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as vault from "@/modules/hr/vault.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/pay-details-requests?status=PENDING|APPROVED|REJECTED|WITHDRAWN&employeeId=&take= —
 * employees' asks to be paid another way or to another account (waiting ones by default).
 */
export const GET = apiRoute(async (request) =>
  vault.listPayRequests(
    await requirePermission("hr.manage"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
