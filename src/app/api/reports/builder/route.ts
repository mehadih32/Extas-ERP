import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import { reportBuilderOptions } from "@/modules/reports/export.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/builder — what the Report Builder offers this person: the metrics (with
 * whether they may pick each), the periods, the formats and the defaults.
 */
export const GET = apiRoute(async () =>
  reportBuilderOptions(await requirePermission("reports.export")),
);
