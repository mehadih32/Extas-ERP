import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as cheques from "@/modules/sales/cheque.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/cheques?status=PENDING|CLEARED|BOUNCED&partyId=&orderId=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  cheques.listCheques(
    await requirePermission("sales.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/sales/cheques — { orderId | proformaId | partyId, amount, chequeNo, bankName?,
 * chequeDate?, allocations? | oldestFirst? }: a cheque received, kept as pending. Nothing
 * reaches the books until it is marked cleared. Accounts / Super Admin only.
 */
export const POST = apiRoute(
  async (request) =>
    cheques.recordCheque(
      await requirePermission("accounts.receipts.record"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
