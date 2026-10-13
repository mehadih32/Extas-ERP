import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as receive from "@/modules/production/receive.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/receive?order= — the batch's purchase orders with
 * goods still to come and, for the order chosen, each line still to come (materials.purchase).
 */
export const GET = apiRoute<Params>(async (request, { batchId }) =>
  receive.getBatchReceive(
    await requirePermission("materials.purchase"),
    batchId,
    new URL(request.url).searchParams.get("order") ?? undefined,
  ),
);

/**
 * POST /api/production/batches/:batchId/receive — { orderId, lines: [{ lineId,
 * challanQuantity?, quantity, unitPrice? }] }: takes in a delivery as a Due bill, keeping
 * the challan quantity of each line; a short beyond the allowance goes into the supplier's
 * fault log and alerts the Production Managers and buyers.
 */
export const POST = apiRoute<Params>(
  async (request, { batchId }) =>
    receive.receiveBatchDelivery(
      await requirePermission("materials.purchase"),
      batchId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
