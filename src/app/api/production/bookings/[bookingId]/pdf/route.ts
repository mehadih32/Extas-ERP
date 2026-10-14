import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { bookingPdf } from "@/modules/production/booking-pdf.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/bookings/:bookingId/pdf — the booking for the supplier, to be
 * spiral-bound: letterhead, QR code, the specification tables, the collar and cuff
 * matrix, the numbered terms (English or Bengali), signatures, initials and page numbers
 * on every page. Without prices for people who may not see them. Made for each request,
 * never kept.
 */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  try {
    const { bookingId } = await context.params;
    const ctx = await requireAnyPermission(
      "production.view",
      "materials.view",
      "materials.purchase",
    );
    const pdf = await bookingPdf(ctx, bookingId, await getRequestMeta());
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
