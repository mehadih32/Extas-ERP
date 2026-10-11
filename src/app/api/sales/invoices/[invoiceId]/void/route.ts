import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as orders from "@/modules/sales/order.service";

type Params = { invoiceId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/invoices/:invoiceId/void — { reason, cancelOrder?, settle? } (audited).
 * With cancelOrder the order is cancelled too: stock back, money held settled.
 */
export const POST = apiRoute<Params>(async (request, { invoiceId }) =>
  orders.voidOrCancelInvoice(
    await requirePermission("sales.invoice.edit"),
    invoiceId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
