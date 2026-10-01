import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as campaigns from "@/modules/parties/campaign.service";

export const dynamic = "force-dynamic";

/** GET /api/parties/campaigns — campaigns with delivery and response counts. */
export const GET = apiRoute(async () =>
  campaigns.listCampaigns(await requirePermission("sales.campaigns.manage")),
);

/**
 * POST /api/parties/campaigns — { name, inactivityMonths, channel, message,
 * catalogFileUrl?, partyIds? }. Without partyIds every dormant wholesale / B2B
 * buyer is included.
 */
export const POST = apiRoute(
  async (request) =>
    campaigns.createCampaign(
      await requirePermission("sales.campaigns.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
