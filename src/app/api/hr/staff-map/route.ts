import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as location from "@/modules/hr/location.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/staff-map?person= — today's shifts: who is on duty, where they
 * checked in and were last seen, who has had no signal; with `person`, that
 * person's trail (hr.manage).
 */
export const GET = apiRoute(async (request) =>
  location.getStaffMap(
    await requirePermission("hr.manage"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
