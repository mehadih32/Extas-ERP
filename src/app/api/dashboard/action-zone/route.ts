import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import { getActionZone } from "@/modules/dashboard/action-zone.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/action-zone?range=TODAY|WEEK|MONTH — the Home screen's Action Zone:
 * overdue invoices by buyer (with a WhatsApp reminder link), low stock, and pending
 * approvals (leave, payroll, and for the owner the period's sales returns and its orders with
 * a discount over 10%). Parts the person does not handle come back as null.
 */
export const GET = apiRoute(async (request) => {
  const ctx = await requireCompany();
  const range = new URL(request.url).searchParams.get("range") ?? undefined;
  return getActionZone(ctx, { range });
});
