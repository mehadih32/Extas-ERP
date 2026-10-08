import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as matrix from "@/modules/inventory/matrix.service";
import * as screens from "@/modules/inventory/screens.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/variants/:variantId — the SKU's prices and its stock in each warehouse. */
export const GET = apiRoute<{ variantId: string }>(async (_request, { variantId }) =>
  screens.getVariantDetails(await requirePermission("inventory.view"), variantId),
);

/** PATCH /api/inventory/variants/:variantId — { barcode?, retailPrice?, wholesalePrice?, isActive? } */
export const PATCH = apiRoute<{ variantId: string }>(async (request, { variantId }) =>
  matrix.updateVariant(
    await requirePermission("inventory.manage"),
    variantId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
