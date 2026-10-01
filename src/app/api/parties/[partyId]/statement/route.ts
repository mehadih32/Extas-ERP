import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as ledger from "@/modules/parties/ledger.service";

type Params = { partyId: string };

export const dynamic = "force-dynamic";

/** GET /api/parties/:partyId/statement?from=2026-01-01&to=2026-06-30 — summary + date-wise log. */
export const GET = apiRoute<Params>(async (request, { partyId }) =>
  ledger.getStatement(
    await requirePermission("parties.ledger.view"),
    partyId,
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
