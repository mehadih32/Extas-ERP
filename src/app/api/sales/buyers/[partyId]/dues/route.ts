import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as credit from "@/modules/sales/credit.service";

type Params = { partyId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/sales/buyers/:partyId/dues — the buyer's previous due, unused credit and
 * unpaid invoices oldest first (what a payment on account can pay). Accounts only.
 */
export const GET = apiRoute<Params>(async (_request, { partyId }) =>
  credit.getBuyerOpenDues(await requirePermission("accounts.receipts.record"), partyId),
);
