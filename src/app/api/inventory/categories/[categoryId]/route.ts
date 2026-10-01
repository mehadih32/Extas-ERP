import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";

type Params = { categoryId: string };

/** PATCH /api/inventory/categories/:categoryId */
export const PATCH = apiRoute<Params>(async (request, { categoryId }) =>
  catalog.updateCategory(
    await requirePermission("inventory.manage"),
    categoryId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/inventory/categories/:categoryId */
export const DELETE = apiRoute<Params>(async (_request, { categoryId }) => {
  await catalog.deleteCategory(
    await requirePermission("inventory.manage"),
    categoryId,
    await getRequestMeta(),
  );
  return null;
});
