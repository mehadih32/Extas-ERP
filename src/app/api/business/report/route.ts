import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany } from "@/modules/auth/context";
import { businessReportFile } from "@/modules/retail/downloads.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/business/report?scope=overview|ecommerce|pos|store&storeId=&period=&from=&to=&parts=a,b&format=pdf|xlsx
 * — a Business page's report (plan v6 sec 12), with the parts ticked. Who may see the
 * page may download it (checked in the service); every download is logged.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireCompany();
    const params = new URL(request.url).searchParams;
    const file = await businessReportFile(
      ctx,
      {
        scope: params.get("scope") ?? undefined,
        storeId: params.get("storeId") || undefined,
        period: params.get("period") || undefined,
        from: params.get("from") || undefined,
        to: params.get("to") || undefined,
        parts: (params.get("parts") ?? "").split(",").filter(Boolean),
        format: params.get("format") === "xlsx" ? "xlsx" : "pdf",
      },
      await getRequestMeta(),
    );
    return fileResponse(file);
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
