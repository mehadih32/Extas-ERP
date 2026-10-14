import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/** GET /api/production/bookings/:bookingId — the booking with its items, specification and matrix. */
export const GET = apiRoute<Params>(async (_request, { bookingId }) =>
  bookings.getBooking(await requireAnyPermission(...bookings.SEE_BOOKINGS), bookingId),
);

/**
 * PATCH /api/production/bookings/:bookingId — the whole booking, as POST
 * /api/production/bookings without batchId. Only while nothing has arrived on it.
 * Needs the permission for the booking's kind (production.bookings.supplier or .market).
 */
export const PATCH = apiRoute<Params>(async (request, { bookingId }) =>
  bookings.updateBooking(
    await requireAnyPermission("production.bookings.supplier", "production.bookings.market"),
    bookingId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
