import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/hr/asset.service";

type Params = { assetId: string };

export const dynamic = "force-dynamic";

/** DELETE /api/hr/items/:assetId — removes an item recorded by mistake. */
export const DELETE = apiRoute<Params>(async (_request, { assetId }) =>
  assets.removeAsset(await requirePermission("hr.manage"), assetId, await getRequestMeta()),
);
