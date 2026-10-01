import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as campaigns from "@/modules/parties/campaign.service";

type Params = { campaignId: string };

export const dynamic = "force-dynamic";

/** POST /api/parties/campaigns/:campaignId/cancel */
export const POST = apiRoute<Params>(async (_request, { campaignId }) =>
  campaigns.cancelCampaign(
    await requirePermission("sales.campaigns.manage"),
    campaignId,
    await getRequestMeta(),
  ),
);
