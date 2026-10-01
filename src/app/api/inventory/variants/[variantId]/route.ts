import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as matrix from "@/modules/inventory/matrix.service";

/** PATCH /api/inventory/variants/:variantId — { barcode?, retailPrice?, wholesalePrice?, isActive? } */
export const PATCH = apiRoute<{ variantId: string }>(async (request, { variantId }) =>
  matrix.updateVariant(
    await requirePermission("inventory.manage"),
    variantId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
