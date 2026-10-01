import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as styles from "@/modules/inventory/style.service";

type Params = { styleId: string };

export const dynamic = "force-dynamic";

/** GET /api/inventory/styles/:styleId */
export const GET = apiRoute<Params>(async (_request, { styleId }) =>
  styles.getStyle(await requirePermission("inventory.view"), styleId),
);

/** PATCH /api/inventory/styles/:styleId — edit, or { isActive: false } to archive. */
export const PATCH = apiRoute<Params>(async (request, { styleId }) =>
  styles.updateStyle(
    await requirePermission("inventory.manage"),
    styleId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/inventory/styles/:styleId — only styles without any history. */
export const DELETE = apiRoute<Params>(async (_request, { styleId }) => {
  await styles.deleteStyle(
    await requirePermission("inventory.manage"),
    styleId,
    await getRequestMeta(),
  );
  return null;
});
