import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { bookingBookPdf } from "@/modules/production/booking-book.service";
import { SEE_BOOKINGS } from "@/modules/production/booking.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/booking-book?orientation=landscape|portrait — the
 * batch's booking book in the book frame: the cover with the distribution list (who gets
 * which part, on which pages), the order summary with style and colour codes, the fabric
 * booked from each mill by style and colour, the collar and cuff matrices, the trims, the
 * summary and reconciliation, the sign-off and the swatch lists. No prices. The
 * orientation picked is kept for this person's next download. Made for each request,
 * never kept. Needs any booking permission.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { batchId } = await context.params;
    const ctx = await requireAnyPermission(...SEE_BOOKINGS);
    const orientation = new URL(request.url).searchParams.get("orientation");
    const pdf = await bookingBookPdf(ctx, batchId, await getRequestMeta(), orientation);
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
