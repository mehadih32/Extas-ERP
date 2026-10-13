import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as actionLog from "@/modules/production/action-log.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/action-log?userId=&kind=&before= — the master
 * batch's Employee Action Log, over the batch and all its styles, newest first
 * (production.view, and production.manage or accounts.view).
 */
export const GET = apiRoute<Params>(async (request, { batchId }) =>
  actionLog.getActionLog(
    await requirePermission("production.view"),
    { batchId },
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
