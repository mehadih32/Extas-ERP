import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as documents from "@/modules/sales/documents.service";

type Params = { packingListId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/packing-lists/:packingListId — pick-list with picked progress. */
export const GET = apiRoute<Params>(async (_request, { packingListId }) =>
  documents.getPackingListDocument(await requirePermission("sales.view"), packingListId),
);
