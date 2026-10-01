import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as styles from "@/modules/inventory/style.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/styles?categoryId=&brandId=&search=&includeInactive=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  styles.listStyles(
    await requirePermission("inventory.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/** POST /api/inventory/styles — { code, name, categoryId, brandId?, prices... } */
export const POST = apiRoute(
  async (request) =>
    styles.createStyle(
      await requirePermission("inventory.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
