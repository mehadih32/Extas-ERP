import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/hr/asset.service";

type Params = { assetId: string };

export const dynamic = "force-dynamic";

/** POST /api/hr/items/:assetId/undo-return — the item is with the employee again (marked back by mistake). */
export const POST = apiRoute<Params>(async (_request, { assetId }) =>
  assets.undoAssetReturn(await requirePermission("hr.manage"), assetId, await getRequestMeta()),
);
