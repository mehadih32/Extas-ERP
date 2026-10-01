import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as summary from "@/modules/sales/summary.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/summary?from=&to= — defaults to today (company time). */
export const GET = apiRoute(async (request) =>
  summary.getSalesSummary(
    await requirePermission("sales.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
