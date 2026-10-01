import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as documents from "@/modules/sales/documents.service";

type Params = { packingListId: string };

export const dynamic = "force-dynamic";

/** PUT /api/sales/packing-lists/:packingListId/pick — { itemIds, isPicked } */
export const PUT = apiRoute<Params>(async (request, { packingListId }) =>
  documents.setPickedItems(
    await requirePermission("sales.order.create"),
    packingListId,
    await readJson(request),
  ),
);
