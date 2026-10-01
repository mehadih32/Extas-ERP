import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as documents from "@/modules/sales/documents.service";

type Params = { invoiceId: string };

export const dynamic = "force-dynamic";

/** POST /api/sales/invoices/:invoiceId/void — { reason } (audited) */
export const POST = apiRoute<Params>(async (request, { invoiceId }) =>
  documents.voidInvoice(
    await requirePermission("sales.invoice.edit"),
    invoiceId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
