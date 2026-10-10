import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as buyer360 from "@/modules/parties/buyer-360.service";

type Params = { partyId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/parties/:partyId/buyer-360?all=orders — a buyer's 360° view: sales,
 * average order, outstanding and overdue, gross profit, the styles they buy most
 * and the order, quotation, payment, production and document history (latest
 * rows; `all` lists one history in full, or `everything`). Figures the reader may
 * not see come back null.
 */
export const GET = apiRoute<Params>(async (request, { partyId }) => {
  const all = new URL(request.url).searchParams.get("all") ?? undefined;
  return buyer360.getBuyer360(
    await requirePermission("parties.view"),
    partyId,
    // The service checks the value.
    { all: all as buyer360.Buyer360Options["all"] },
  );
});
