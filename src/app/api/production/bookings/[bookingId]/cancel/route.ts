import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/bookings/:bookingId/cancel — { reason }. Only while nothing has arrived on it (the supplier will not deliver).
 * Needs production.bookings.close.
 */
export const POST = apiRoute<Params>(async (request, { bookingId }) =>
  bookings.cancelBooking(
    await requirePermission("production.bookings.close"),
    bookingId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
