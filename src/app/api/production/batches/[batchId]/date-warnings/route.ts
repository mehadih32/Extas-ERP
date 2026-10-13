import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as cutting from "@/modules/production/cutting.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/date-warnings — the batch's styles whose cutting or
 * sewing is late or due within three days (production.view).
 */
export const GET = apiRoute<Params>(async (_request, { batchId }) =>
  cutting.batchDateWarnings(await requirePermission("production.view"), batchId),
);
