import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/batches/:batchId/bookings — the bookings on the batch and, for
 * buyers and Production Managers, the open bookings that could be attached to it.
 */
export const GET = apiRoute<Params>(async (_request, { batchId }) =>
  bookings.getBatchBookings(await requireAnyPermission(...bookings.SEE_BOOKINGS), batchId),
);
