import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as location from "@/modules/hr/location.service";

type Params = { placeId: string };

export const dynamic = "force-dynamic";

/** PATCH /api/hr/work-places/:placeId — { name?, address?, lat?, lng?, radiusMeters? }. */
export const PATCH = apiRoute<Params>(async (request, { placeId }) =>
  location.updateWorkPlace(
    await requirePermission("hr.manage"),
    placeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/hr/work-places/:placeId — no longer used; past check-ins keep its name. */
export const DELETE = apiRoute<Params>(async (_request, { placeId }) =>
  location.removeWorkPlace(await requirePermission("hr.manage"), placeId, await getRequestMeta()),
);
