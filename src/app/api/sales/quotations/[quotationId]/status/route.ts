import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as quotations from "@/modules/sales/quotation.service";

type Params = { quotationId: string };

export const dynamic = "force-dynamic";

/** PUT /api/sales/quotations/:quotationId/status — { status: "SENT" | "ACCEPTED" | "REJECTED" } */
export const PUT = apiRoute<Params>(async (request, { quotationId }) =>
  quotations.setQuotationStatus(
    await requirePermission("sales.quotation.manage"),
    quotationId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
