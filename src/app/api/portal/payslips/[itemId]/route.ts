import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

type Params = { itemId: string };

export const dynamic = "force-dynamic";

/** GET /api/portal/payslips/:itemId */
export const GET = apiRoute<Params>(async (_request, { itemId }) =>
  payroll.myPayslip(await requirePermission("portal.self"), itemId),
);
