import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as proformas from "@/modules/sales/proforma.service";

type Params = { proformaId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/proformas/:proformaId — with advance due, payments and production. */
export const GET = apiRoute<Params>(async (_request, { proformaId }) =>
  proformas.getProforma(await requirePermission("sales.view"), proformaId),
);

/**
 * PATCH /api/sales/proformas/:proformaId — { buyerPoNumber?, validUntil?, bankAccountId? }
 * on a proforma that is still open (not converted or cancelled). null clears a field.
 */
export const PATCH = apiRoute<Params>(async (request, { proformaId }) =>
  proformas.updateProforma(
    await requirePermission("sales.quotation.manage"),
    proformaId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
