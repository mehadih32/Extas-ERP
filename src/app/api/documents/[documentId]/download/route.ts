import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as printing from "@/modules/documents/print.service";

type Params = { documentId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/documents/:documentId/download — the PDF (or the Word / HTML file filled from a
 * custom template). Add ?inline=1 to open a PDF in the browser (to print) instead of saving
 * it; Word and HTML files always download. Every download is audited.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { documentId } = await context.params;
    const inline = ["1", "true"].includes(new URL(request.url).searchParams.get("inline") ?? "");
    const file = await printing.downloadDocument(
      await requireAnyPermission(...printing.PRINT_PERMISSIONS),
      documentId,
      await getRequestMeta(),
    );
    return fileResponse(file, inline ? "inline" : "attachment");
  } catch (error) {
    return apiErrorResponse(error);
  }
}
