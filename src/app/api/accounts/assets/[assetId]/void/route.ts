import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/accounts/asset.service";

type Params = { assetId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/assets/:assetId/void — { reason }: removes an asset entered by mistake
 * (its entries are reversed).
 */
export const POST = apiRoute<Params>(async (request, { assetId }) =>
  assets.voidFixedAsset(
    await requirePermission("accounts.manage"),
    assetId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
