import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { bookingId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/bookings/:bookingId/attach — { batchId }: puts an open booking on a
 * master batch. Its goods are received in the batch's central receive and each item the
 * styles need is shared out over them; `unmatched` lists the items no style needs. Needs
 * materials.purchase or production.manage.
 */
export const POST = apiRoute<Params>(async (request, { bookingId }) =>
  bookings.attachBooking(
    await requireAnyPermission("materials.purchase", "production.manage"),
    bookingId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
