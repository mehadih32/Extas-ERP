import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/reports/export.service";

export const dynamic = "force-dynamic";

/** GET /api/reports/exports?mine=&cursor=&take= — saved reports this person may open, newest first. */
export const GET = apiRoute(async (request) =>
  reports.listReportExports(
    await requirePermission("reports.export"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/reports/exports — { format: PDF | EXCEL, title?, period?, from?, to?, metrics?,
 * topLimit?, alertLimit?, slowDays?, coverDays? }. Makes the file now and keeps it; download it
 * from /api/reports/exports/:exportId/download.
 */
export const POST = apiRoute(
  async (request) =>
    reports.generateReport(
      await requirePermission("reports.export"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
