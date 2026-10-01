import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as documents from "@/modules/sales/documents.service";

type Params = { challanId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/challans/:challanId — price-free delivery challan. */
export const GET = apiRoute<Params>(async (_request, { challanId }) =>
  documents.getChallanDocument(await requirePermission("sales.view"), challanId),
);
