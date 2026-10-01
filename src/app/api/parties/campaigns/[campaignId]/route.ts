import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as campaigns from "@/modules/parties/campaign.service";

type Params = { campaignId: string };

export const dynamic = "force-dynamic";

/** GET /api/parties/campaigns/:campaignId — recipients with personalised messages and links. */
export const GET = apiRoute<Params>(async (_request, { campaignId }) =>
  campaigns.getCampaign(await requirePermission("sales.campaigns.manage"), campaignId),
);
