import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as payroll from "@/modules/hr/payroll.service";

export const dynamic = "force-dynamic";

/** GET /api/portal/payslips — your payslips from approved payrolls. */
export const GET = apiRoute(async () => payroll.myPayslips(await requirePermission("portal.self")));
