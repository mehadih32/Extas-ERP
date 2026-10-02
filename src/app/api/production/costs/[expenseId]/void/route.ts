import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as costs from "@/modules/production/cost.service";

type Params = { expenseId: string };

export const dynamic = "force-dynamic";

/** POST /api/production/costs/:expenseId/void — { reason }. Reverses a cash cost (Accounts). */
export const POST = apiRoute<Params>(async (request, { expenseId }) =>
  costs.voidProjectCost(
    await requirePermission("accounts.payments.record"),
    expenseId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
