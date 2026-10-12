import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as overtime from "@/modules/hr/overtime.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/overtime/approve-all — { month }: approves the month's waiting overtime as found,
 * except entries with a flag and one's own (hr.manage).
 */
export const POST = apiRoute(async (request) =>
  overtime.approveAllOvertime(
    await requirePermission("hr.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
