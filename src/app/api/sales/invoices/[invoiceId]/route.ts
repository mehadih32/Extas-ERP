import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as documents from "@/modules/sales/documents.service";

type Params = { invoiceId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/invoices/:invoiceId — commercial invoice with paid / due breakdown. */
export const GET = apiRoute<Params>(async (_request, { invoiceId }) =>
  documents.getInvoiceDocument(await requirePermission("sales.view"), invoiceId),
);
