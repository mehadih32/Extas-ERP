import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as quotations from "@/modules/sales/quotation.service";

type Params = { quotationId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/quotations/:quotationId — full quotation with letterhead details. */
export const GET = apiRoute<Params>(async (_request, { quotationId }) =>
  quotations.getQuotation(await requirePermission("sales.view"), quotationId),
);

/** PATCH /api/sales/quotations/:quotationId — edit a draft or sent quotation. */
export const PATCH = apiRoute<Params>(async (request, { quotationId }) =>
  quotations.updateQuotation(
    await requirePermission("sales.quotation.manage"),
    quotationId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/sales/quotations/:quotationId — drafts only. */
export const DELETE = apiRoute<Params>(async (_request, { quotationId }) => {
  await quotations.deleteQuotation(
    await requirePermission("sales.quotation.manage"),
    quotationId,
    await getRequestMeta(),
  );
  return null;
});
