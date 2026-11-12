import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as printing from "@/modules/documents/print.service";
import * as sending from "@/modules/documents/send.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/document-sends?referenceIds=a,b&partyId=&type= — every time a document was sent
 * to a buyer (email, WhatsApp link, the phone's Share), newest first, only for kinds of
 * documents this person sees, with each WhatsApp link's state.
 */
export const GET = apiRoute(async (request) => {
  const query = new URL(request.url).searchParams;
  const ids = query.get("referenceIds");
  const take = query.get("take");
  return sending.listDocumentSends(await requireAnyPermission(...printing.PRINT_PERMISSIONS), {
    referenceIds: ids ? ids.split(",").filter(Boolean) : undefined,
    partyId: query.get("partyId") ?? undefined,
    type: query.get("type") ?? undefined,
    ...(take ? { take: Number(take) } : {}),
  });
});
