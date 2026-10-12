import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as contracts from "@/modules/production/contract.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/contracts — the batch's fabric, accessories and
 * factory (CM) agreements, and the ones still to draft (production.manage or accounts.view).
 */
export const GET = apiRoute<Params>(async (_request, { batchId }) =>
  contracts.getBatchContracts(
    await requireAnyPermission("production.manage", "accounts.view"),
    batchId,
  ),
);

/**
 * POST /api/production/batches/:batchId/contracts — { kind: FABRIC | ACCESSORIES |
 * FACTORY_CM, partyId }: drafts the agreement with that supplier or factory, its clauses
 * worded from the batch.
 */
export const POST = apiRoute<Params>(
  async (request, { batchId }) =>
    contracts.createContract(
      await requirePermission("production.manage"),
      batchId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
