import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as proformas from "@/modules/sales/proforma.service";

type Params = { proformaId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/proformas/:proformaId/cancel — { reason, settle? }. An advance still held on it
 * needs settle (as for cancelling an order) or a refund by Accounts first. Its production project,
 * if started, keeps running.
 */
export const POST = apiRoute<Params>(async (request, { proformaId }) =>
  proformas.cancelProforma(
    await requirePermission("sales.quotation.manage"),
    proformaId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
