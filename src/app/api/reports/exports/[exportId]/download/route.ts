import { apiErrorResponse } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/reports/export.service";

type Params = { exportId: string };

/** RFC 5987 encoding: encodeURIComponent leaves ' ( ) * as they are. */
const encodeFileName = (name: string) =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const dynamic = "force-dynamic";

/** GET /api/reports/exports/:exportId/download — the PDF or Excel file. Every download is audited. */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  try {
    const { exportId } = await context.params;
    const file = await reports.downloadReportExport(
      await requirePermission("reports.export"),
      exportId,
      await getRequestMeta(),
    );
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeFileName(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
