import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as costs from "@/modules/production/cost.service";

export const dynamic = "force-dynamic";

/** GET /api/production/cost-heads?includeInactive= — Fabric, Trims, Cutting, Sewing (CM)... */
export const GET = apiRoute(async (request) =>
  costs.listCostHeads(
    await requirePermission("production.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/** POST /api/production/cost-heads — { name, category?: "PRODUCTION" | "RAW_MATERIAL" }. */
export const POST = apiRoute(
  async (request) =>
    costs.createCostHead(
      await requirePermission("production.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
