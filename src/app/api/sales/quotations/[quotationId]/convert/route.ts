import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as proformas from "@/modules/sales/proforma.service";

type Params = { quotationId: string };

export const dynamic = "force-dynamic";

/** POST /api/sales/quotations/:quotationId/convert — make a proforma invoice { advancePercent? } */
export const POST = apiRoute<Params>(
  async (request, { quotationId }) =>
    proformas.convertQuotationToProforma(
      await requirePermission("sales.quotation.manage"),
      quotationId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
