import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * PATCH /api/production/bookings/:bookingId/paperwork — { expectedDate?, supplierRef?,
 * title?, styleRef?, deliveryPlace?, paymentTerms?, termsLanguage?, terms?, notes? }: also
 * after goods have arrived, while the booking is open. Needs materials.purchase.
 */
export const PATCH = apiRoute<Params>(async (request, { bookingId }) =>
  bookings.updateBookingPaperwork(
    await requirePermission("materials.purchase"),
    bookingId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
