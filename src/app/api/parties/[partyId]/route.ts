import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as parties from "@/modules/parties/party.service";

type Params = { partyId: string };

export const dynamic = "force-dynamic";

/** GET /api/parties/:partyId — 360° profile with balance and activity counts. */
export const GET = apiRoute<Params>(async (_request, { partyId }) =>
  parties.getPartyProfile(await requirePermission("parties.view"), partyId),
);

/** PATCH /api/parties/:partyId — edit details. */
export const PATCH = apiRoute<Params>(async (request, { partyId }) =>
  parties.updateParty(
    await requirePermission("parties.manage"),
    partyId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
