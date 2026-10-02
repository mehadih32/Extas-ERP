import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as costs from "@/modules/production/cost.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/costs — the cost sheet: totals, cost per head,
 * every bill line and cash cost, cost per piece. Needs production.manage or accounts.view.
 */
export const GET = apiRoute<Params>(async (_request, { projectId }) =>
  costs.getProjectCostSheet(await requirePermission("production.view"), projectId),
);

/**
 * POST /api/production/projects/:projectId/costs — { expenseHeadId, amount, paymentType: "DUE" |
 * "CASH_BANK", supplierId? (needed for DUE), supplierRef?, date?, description?, method?,
 * accountId?, reference? }.
 * Due costs: production.manage. Paid now in cash or bank: accounts.payments.record.
 */
export const POST = apiRoute<Params>(
  async (request, { projectId }) =>
    costs.addProjectCost(
      await requireAnyPermission("production.manage", "accounts.payments.record"),
      projectId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
