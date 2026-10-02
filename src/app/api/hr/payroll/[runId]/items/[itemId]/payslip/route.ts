import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { runId: string; itemId: string };

export const dynamic = "force-dynamic";

/** GET /api/hr/payroll/:runId/items/:itemId/payslip — printable payslip data (net pay in words). */
export const GET = apiRoute<Params>(async (_request, { runId, itemId }) =>
  payroll.getPayslip(
    await requireAnyPermission("hr.manage", "hr.payroll", "accounts.view"),
    runId,
    itemId,
  ),
);
