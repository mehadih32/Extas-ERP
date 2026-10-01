import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as ledger from "@/modules/parties/ledger.service";

type Params = { partyId: string };

export const dynamic = "force-dynamic";

/** PUT /api/parties/:partyId/opening-balance — { amount, asOf? }. + they owe us, - we owe them. */
export const PUT = apiRoute<Params>(async (request, { partyId }) =>
  ledger.setOpeningBalance(
    await requirePermission("accounts.manage"),
    partyId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
