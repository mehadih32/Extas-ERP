import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as capital from "@/modules/accounts/capital.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/installments?status=&overdue=&sourceId=&from=&to= — installment payouts
 * across every loan and investor (upcoming, overdue, paid).
 */
export const GET = apiRoute(async (request) =>
  capital.listInstallments(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
