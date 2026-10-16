import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/bookings/:bookingId/approve — approves a draft booking (or its
 * draft revision) once its checks pass. Needs production.bookings.approve. An optional
 * `{ overrideReason }` approves past a check that allows it (kept in the activity log).
 */
export const POST = apiRoute<Params>(async (request, { bookingId }) =>
  bookings.approveBooking(
    await requirePermission("production.bookings.approve"),
    bookingId,
    await getRequestMeta(),
    await readJson(request),
  ),
);
