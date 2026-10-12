import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as terms from "@/modules/hr/terms.service";

export const dynamic = "force-dynamic";

/** POST /api/hr/terms/agreements/:acceptanceId/pdf — makes a signed copy that failed again. */
export const POST = apiRoute<{ acceptanceId: string }>(async (_request, { acceptanceId }) =>
  terms.remakeTermsPdf(await requirePermission("hr.manage"), acceptanceId, await getRequestMeta()),
);
