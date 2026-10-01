import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as matrix from "@/modules/inventory/matrix.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/ratio-presets — Saved Ratio Fill presets. */
export const GET = apiRoute(async () =>
  matrix.listRatioPresets(await requirePermission("inventory.view")),
);

/** POST /api/inventory/ratio-presets */
export const POST = apiRoute(
  async (request) =>
    matrix.createRatioPreset(
      await requirePermission("inventory.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
