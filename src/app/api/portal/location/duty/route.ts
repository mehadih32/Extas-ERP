import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as location from "@/modules/hr/location.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/location/duty — whether this phone should send its position now
 * (checked in with GPS attendance on), and how often; null when it does not apply.
 */
export const GET = apiRoute(async () =>
  location.getDutyState(await requirePermission("portal.self")),
);
