import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as batches from "@/modules/production/batch.service";

export const dynamic = "force-dynamic";

/** GET /api/production/batches — master batches with their styles' totals (state, kind, search). */
export const GET = apiRoute(async (request) =>
  batches.listBatches(
    await requirePermission("production.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/** POST /api/production/batches — a new master batch (name, kind, factory, target day). */
export const POST = apiRoute(
  async (request) =>
    batches.createBatch(
      await requirePermission("production.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
