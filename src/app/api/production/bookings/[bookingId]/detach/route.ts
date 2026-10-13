import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/bookings/:bookingId/detach — takes the booking off its batch while
 * nothing has arrived on it. Needs materials.purchase or production.manage.
 */
export const POST = apiRoute<Params>(async (_request, { bookingId }) =>
  bookings.detachBooking(
    await requireAnyPermission("materials.purchase", "production.manage"),
    bookingId,
    await getRequestMeta(),
  ),
);
