import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/hr/asset.service";

type Params = { assetId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/items/:assetId/return — { returnedOn, condition: GOOD | DAMAGED | LOST, note? }:
 * the item came back (or was lost; damaged or lost needs a note).
 */
export const POST = apiRoute<Params>(async (request, { assetId }) =>
  assets.returnAsset(
    await requirePermission("hr.manage"),
    assetId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
