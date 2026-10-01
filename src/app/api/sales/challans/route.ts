import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as documents from "@/modules/sales/documents.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/challans?orderId=&partyId=&search= — historical challan lookup. */
export const GET = apiRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  return documents.listChallans(await requirePermission("sales.view"), {
    orderId: params.get("orderId") ?? undefined,
    partyId: params.get("partyId") ?? undefined,
    search: params.get("search") ?? undefined,
  });
});
