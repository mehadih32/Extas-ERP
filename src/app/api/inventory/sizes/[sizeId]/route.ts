import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";

type Params = { sizeId: string };

/** PATCH /api/inventory/sizes/:sizeId */
export const PATCH = apiRoute<Params>(async (request, { sizeId }) =>
  catalog.updateSize(
    await requirePermission("inventory.manage"),
    sizeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/inventory/sizes/:sizeId */
export const DELETE = apiRoute<Params>(async (_request, { sizeId }) => {
  await catalog.deleteSize(
    await requirePermission("inventory.manage"),
    sizeId,
    await getRequestMeta(),
  );
  return null;
});
