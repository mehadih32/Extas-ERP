import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import { batchMaterialPlan } from "@/modules/production/batch-orders.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/materials — what the batch's open styles need of
 * each material, what is on order already and what is still to order.
 */
export const GET = apiRoute<Params>(async (_request, { batchId }) =>
  batchMaterialPlan(await requirePermission("production.view"), batchId),
);
