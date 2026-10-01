import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as parties from "@/modules/parties/party.service";

type Params = { partyId: string };

export const dynamic = "force-dynamic";

/** PUT /api/parties/:partyId/verify — { isVerified: true | false } (Blue Verified badge) */
export const PUT = apiRoute<Params>(async (request, { partyId }) =>
  parties.setPartyVerified(
    await requirePermission("parties.manage"),
    partyId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
