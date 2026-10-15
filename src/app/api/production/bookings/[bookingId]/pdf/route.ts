import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import { bookingPdf } from "@/modules/production/booking-pdf.service";
import { SEE_BOOKINGS } from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/bookings/:bookingId/pdf?orientation=landscape|portrait — the
 * booking for the supplier in the book frame: the company's header under a blank
 * binding strip, QR code, the specification tables, the collar and cuff matrix, the
 * numbered terms (English or Bengali), signatures, the fabric swatch list, initials and
 * "PAGE n OF N" on every page. Without prices for people who may not see them. The
 * orientation picked is kept for this person's next download; without one, their last
 * pick (or the company's default) is used. Made for each request, never kept.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { bookingId } = await context.params;
    const ctx = await requireAnyPermission(...SEE_BOOKINGS);
    const orientation = new URL(request.url).searchParams.get("orientation");
    const pdf = await bookingPdf(ctx, bookingId, await getRequestMeta(), orientation);
    return fileResponse({ fileName: pdf.fileName, mimeType: PDF_MIME, bytes: pdf.bytes });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
