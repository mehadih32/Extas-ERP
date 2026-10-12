import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { purchaseOrderPdf } from "@/modules/materials/order-pdf.service";

type Params = { orderId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/materials/purchase-orders/:orderId/pdf — the order for the supplier as a PDF:
 * its lines with pictures and prices ("At receive" when agreed on arrival), and for a
 * master batch the style-wise breakdown and the collar and cuff matrices. Prices only
 * for people who see material prices. Made for each request, never kept.
 */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  try {
    const { orderId } = await context.params;
    const ctx = await requirePermission("materials.view");
    const pdf = await purchaseOrderPdf(ctx, orderId, await getRequestMeta());
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
