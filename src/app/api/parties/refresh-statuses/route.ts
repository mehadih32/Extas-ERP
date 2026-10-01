import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as dormant from "@/modules/parties/dormant.service";

export const dynamic = "force-dynamic";

/** POST /api/parties/refresh-statuses — mark inactive buyers dormant, close settled accounts. */
export const POST = apiRoute(async () =>
  dormant.refreshPartyStatuses(await requirePermission("parties.manage"), await getRequestMeta()),
);
