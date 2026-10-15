import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/bookings/:bookingId/sent — marks an approved booking as sent to its
 * supplier. Needs the permission that makes that kind of booking.
 */
export const POST = apiRoute<Params>(async (_request, { bookingId }) =>
  bookings.markBookingSent(
    await requireAnyPermission("production.bookings.supplier", "production.bookings.market"),
    bookingId,
    await getRequestMeta(),
  ),
);
