import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as batches from "@/modules/production/batch.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/** GET /api/production/batches/:batchId — the batch with its styles' totals and cost guard. */
export const GET = apiRoute<Params>(async (_request, { batchId }) =>
  batches.getBatch(await requirePermission("production.view"), batchId),
);

/** PATCH /api/production/batches/:batchId — name, kind, factory, target day, notes. */
export const PATCH = apiRoute<Params>(async (request, { batchId }) =>
  batches.updateBatch(
    await requirePermission("production.manage"),
    batchId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/production/batches/:batchId — only a batch with no styles. */
export const DELETE = apiRoute<Params>(async (_request, { batchId }) =>
  batches.deleteBatch(
    await requirePermission("production.manage"),
    batchId,
    await getRequestMeta(),
  ),
);
