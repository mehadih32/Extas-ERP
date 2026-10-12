import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as location from "@/modules/hr/location.service";

export const dynamic = "force-dynamic";

/** GET /api/hr/work-places — where staff check in, each with its radius. */
export const GET = apiRoute(async () =>
  location.listWorkPlaces(await requireAnyPermission("hr.view", "hr.manage", "hr.payroll")),
);

/** POST /api/hr/work-places — { name, address?, lat, lng, radiusMeters? } (hr.manage). */
export const POST = apiRoute(
  async (request) =>
    location.createWorkPlace(
      await requirePermission("hr.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
