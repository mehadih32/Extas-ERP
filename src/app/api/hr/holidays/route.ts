import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as settings from "@/modules/hr/settings.service";

export const dynamic = "force-dynamic";

/** GET /api/hr/holidays?year= — the year's holidays (paid days off). */
export const GET = apiRoute(async (request) =>
  settings.listHolidays(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll", "portal.self"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/hr/holidays — { date, name } or { holidays: [{ date, name }] } (e.g. the year's public
 * holidays).
 */
export const POST = apiRoute(
  async (request) =>
    settings.createHolidays(
      await requirePermission("hr.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
