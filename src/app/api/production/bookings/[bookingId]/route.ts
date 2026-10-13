import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/** GET /api/production/bookings/:bookingId — the booking with its items, specification and matrix. */
export const GET = apiRoute<Params>(async (_request, { bookingId }) =>
  bookings.getBooking(
    await requireAnyPermission("production.view", "materials.view", "materials.purchase"),
    bookingId,
  ),
);

/**
 * PATCH /api/production/bookings/:bookingId — the whole booking, as POST
 * /api/production/bookings without batchId. Only while nothing has arrived on it.
 * Needs materials.purchase.
 */
export const PATCH = apiRoute<Params>(async (request, { bookingId }) =>
  bookings.updateBooking(
    await requirePermission("materials.purchase"),
    bookingId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
