import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

export const dynamic = "force-dynamic";

/** GET /api/hr/payroll?year= — monthly payrolls with their totals and what is unpaid. */
export const GET = apiRoute(async (request) =>
  payroll.listPayrollRuns(
    await requireAnyPermission("hr.manage", "hr.payroll", "accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/hr/payroll — { month: "2026-10", notes? }: a draft for everyone employed that month.
 */
export const POST = apiRoute(
  async (request) =>
    payroll.createPayrollRun(
      await requirePermission("hr.payroll"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
