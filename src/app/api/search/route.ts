import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import { globalSearch } from "@/modules/search/search.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=… — the top bar's search box: the newest few matches of each kind
 * of record this person may open (orders, invoices, quotations, proforma invoices,
 * buyers and suppliers, styles, bookings, purchase orders, production projects and
 * batches, tech packs, employees), grouped by kind, each with its page's address.
 * Never a price, a cost or a salary. Fewer than 2 letters find nothing.
 */
export const GET = apiRoute(async (request) =>
  globalSearch(await requireCompany(), { q: new URL(request.url).searchParams.get("q") ?? "" }),
);
