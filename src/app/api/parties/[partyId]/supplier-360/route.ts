import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as supplier360 from "@/modules/parties/supplier-360.service";

type Params = { partyId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/parties/:partyId/supplier-360?all=bills — a supplier's 360° view:
 * what is due to them on their ledger, billed and paid in all, their active and
 * completed projects (with each project's balance and the settlement made when
 * it closed), the goods they delivered, and their purchase orders, bills,
 * payments and documents (latest rows; `all` lists one in full, or `everything`).
 * Parts the reader may not see come back null.
 */
export const GET = apiRoute<Params>(async (request, { partyId }) => {
  const all = new URL(request.url).searchParams.get("all") ?? undefined;
  return supplier360.getSupplier360(
    await requirePermission("parties.view"),
    partyId,
    // The service checks the value.
    { all: all as supplier360.Supplier360Options["all"] },
  );
});
