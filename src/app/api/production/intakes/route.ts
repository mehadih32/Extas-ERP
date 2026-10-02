import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as intakes from "@/modules/production/intake.service";

export const dynamic = "force-dynamic";

/** GET /api/production/intakes?projectId=&status=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  intakes.listIntakes(
    await requireAnyPermission("production.view", "production.stock_intake"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/production/intakes — a factory delivery for a project, saved as a draft:
 * { projectId, warehouseId?, sourceFileId?, parse?, lines?: [{ variantId, grade?, quantity,
 * unitCost? }], matrix?: [{ styleId, grade?, quantities }], costAllocation?, bGradeCostRatio?,
 * notes? }. With a packing-list file and no lines, the AI reader fills the lines in.
 */
export const POST = apiRoute(
  async (request) =>
    intakes.createIntake(
      await requirePermission("production.stock_intake"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
