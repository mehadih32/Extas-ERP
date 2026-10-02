import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import { previewReport } from "@/modules/reports/export.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/preview?title=&period=&from=&to=&metrics=SUMMARY,SALES&topLimit=&alertLimit=
 * &slowDays=&coverDays= — the report's content as data, without making a file.
 */
export const GET = apiRoute(async (request) =>
  previewReport(
    await requirePermission("reports.export"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
