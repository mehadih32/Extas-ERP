import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as matrix from "@/modules/inventory/matrix.service";

type Params = { presetId: string };

/** PATCH /api/inventory/ratio-presets/:presetId */
export const PATCH = apiRoute<Params>(async (request, { presetId }) =>
  matrix.updateRatioPreset(
    await requirePermission("inventory.manage"),
    presetId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/inventory/ratio-presets/:presetId */
export const DELETE = apiRoute<Params>(async (_request, { presetId }) => {
  await matrix.deleteRatioPreset(
    await requirePermission("inventory.manage"),
    presetId,
    await getRequestMeta(),
  );
  return null;
});
