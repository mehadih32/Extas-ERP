import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { costsFile } from "@/modules/ai/costs-export";
import { requireAnyPermission } from "@/modules/auth/context";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/costs/export?period=&from=&to=&person=&format=pdf|xlsx — what the AI
 * spent in a period as a PDF (totals, breakdowns, the newest calls) or an Excel
 * workbook (every call). For the people who see the AI Center. Made for each
 * request, never kept.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireAnyPermission("ai.view", "ai.manage");
    const params = new URL(request.url).searchParams;
    const format = params.get("format") === "xlsx" ? "xlsx" : "pdf";
    const query = {
      period: params.get("period") ?? undefined,
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      userId: params.get("person") || undefined,
    };
    const file = await costsFile(ctx, query, format, await getRequestMeta());
    return fileResponse(file);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
