import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as settings from "@/modules/hr/settings.service";

type Params = { holidayId: string };

export const dynamic = "force-dynamic";

/** DELETE /api/hr/holidays/:holidayId */
export const DELETE = apiRoute<Params>(async (_request, { holidayId }) =>
  settings.deleteHoliday(await requirePermission("hr.manage"), holidayId, await getRequestMeta()),
);
