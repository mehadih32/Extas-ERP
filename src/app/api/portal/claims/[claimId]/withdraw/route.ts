import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as claims from "@/modules/hr/claims.service";

type Params = { claimId: string };

export const dynamic = "force-dynamic";

/** POST /api/portal/claims/:claimId/withdraw — takes back your claim while it waits. */
export const POST = apiRoute<Params>(async (_request, { claimId }) =>
  claims.withdrawMyClaim(await requirePermission("portal.self"), claimId, await getRequestMeta()),
);
