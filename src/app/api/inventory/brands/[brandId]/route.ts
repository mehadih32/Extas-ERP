import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";

type Params = { brandId: string };

/** PATCH /api/inventory/brands/:brandId */
export const PATCH = apiRoute<Params>(async (request, { brandId }) =>
  catalog.updateBrand(
    await requirePermission("inventory.manage"),
    brandId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/inventory/brands/:brandId */
export const DELETE = apiRoute<Params>(async (_request, { brandId }) => {
  await catalog.deleteBrand(
    await requirePermission("inventory.manage"),
    brandId,
    await getRequestMeta(),
  );
  return null;
});
