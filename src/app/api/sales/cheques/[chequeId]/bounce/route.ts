import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as cheques from "@/modules/sales/cheque.service";

type Params = { chequeId: string };

export const dynamic = "force-dynamic";

/** POST /api/sales/cheques/:chequeId/bounce — { reason, bouncedOn? }: nothing is posted. */
export const POST = apiRoute<Params>(async (request, { chequeId }) =>
  cheques.bounceCheque(
    await requirePermission("accounts.receipts.record"),
    chequeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
