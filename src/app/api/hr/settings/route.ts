import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as settings from "@/modules/hr/settings.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/settings — HR rules: weekly days off, office start time, late rules, self check-in.
 */
export const GET = apiRoute(async () =>
  settings.getHrSettings(await requireAnyPermission("hr.view", "hr.manage", "hr.payroll")),
);

/**
 * PATCH /api/hr/settings — { weeklyOffDays?, officeStartTime?, lateGraceMinutes?,
 * latesPerDeductionDay?, selfCheckIn? }. Changing days off re-counts leave not yet in an approved
 * payroll.
 */
export const PATCH = apiRoute(async (request) =>
  settings.updateHrSettings(
    await requirePermission("hr.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
