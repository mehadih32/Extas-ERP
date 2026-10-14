import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/bookings/:bookingId/close — { reason }. Once part has arrived: the rest will not come.
 * Needs production.bookings.close.
 */
export const POST = apiRoute<Params>(async (request, { bookingId }) =>
  bookings.closeBooking(
    await requirePermission("production.bookings.close"),
    bookingId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
