import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as salesReturns from "@/modules/sales/return.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/returns?search=&partyId=&invoiceId=&orderId=&from=&to=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  salesReturns.listSalesReturns(
    await requirePermission("sales.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/sales/returns — { invoiceId, items: [{ orderItemId, quantity }], reason,
 * returnDate?, notes? }. Goods back on an invoice (accounts.receipts.record): credited at the
 * prices billed (with their share of the invoice's discount and VAT) to the buyer's account, the
 * pieces moved to Damage & QC Rejects. Returns the credit note (CN-).
 */
export const POST = apiRoute(
  async (request) =>
    salesReturns.createSalesReturn(
      await requirePermission("accounts.receipts.record"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
