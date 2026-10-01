import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as campaigns from "@/modules/parties/campaign.service";

type Params = { campaignId: string; recipientId: string };

export const dynamic = "force-dynamic";

/**
 * PATCH /api/parties/campaigns/:campaignId/recipients/:recipientId —
 * { status: "SENT" | "DELIVERED" | "READ" | "FAILED", error?, responded? }
 */
export const PATCH = apiRoute<Params>(async (request, { campaignId, recipientId }) =>
  campaigns.updateRecipientStatus(
    await requirePermission("sales.campaigns.manage"),
    campaignId,
    recipientId,
    await readJson(request),
  ),
);
