import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";

type Params = { colorId: string };

/** PATCH /api/inventory/colors/:colorId */
export const PATCH = apiRoute<Params>(async (request, { colorId }) =>
  catalog.updateColor(
    await requirePermission("inventory.manage"),
    colorId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/inventory/colors/:colorId */
export const DELETE = apiRoute<Params>(async (_request, { colorId }) => {
  await catalog.deleteColor(
    await requirePermission("inventory.manage"),
    colorId,
    await getRequestMeta(),
  );
  return null;
});
