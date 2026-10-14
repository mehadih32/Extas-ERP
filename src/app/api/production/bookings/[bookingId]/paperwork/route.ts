import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * PATCH /api/production/bookings/:bookingId/paperwork — { expectedDate?, supplierRef?,
 * title?, styleRef?, deliveryPlace?, paymentTerms?, termsLanguage?, terms?, notes? }: also
 * after goods have arrived, while the booking is open. Needs the permission for the
 * booking's kind (production.bookings.supplier or .market).
 */
export const PATCH = apiRoute<Params>(async (request, { bookingId }) =>
  bookings.updateBookingPaperwork(
    await requireAnyPermission("production.bookings.supplier", "production.bookings.market"),
    bookingId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
