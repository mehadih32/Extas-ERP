import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/accounts/asset.service";

type Params = { assetId: string };

export const dynamic = "force-dynamic";

/** GET /api/accounts/assets/:assetId — the asset with its purchase and depreciation history. */
export const GET = apiRoute<Params>(async (_request, { assetId }) =>
  assets.getFixedAsset(await requirePermission("accounts.view"), assetId),
);

/** PATCH /api/accounts/assets/:assetId — details, status (IN_USE / UNDER_REPAIR), depreciation terms. */
export const PATCH = apiRoute<Params>(async (request, { assetId }) =>
  assets.updateFixedAsset(
    await requirePermission("accounts.manage"),
    assetId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
