import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as proformas from "@/modules/sales/proforma.service";

type Params = { proformaId: string };

export const dynamic = "force-dynamic";

/** POST /api/sales/proformas/:proformaId/cancel — { reason } (no advance paid yet) */
export const POST = apiRoute<Params>(async (request, { proformaId }) =>
  proformas.cancelProforma(
    await requirePermission("sales.quotation.manage"),
    proformaId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
