import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as styles from "@/modules/inventory/style.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/tree — Category -> Brand -> Style navigation. */
export const GET = apiRoute(async () =>
  styles.getInventoryTree(await requirePermission("inventory.view")),
);
