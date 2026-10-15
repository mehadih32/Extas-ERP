import { z } from "zod";

import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

type Params = { batchId: string };

export const dynamic = "force-dynamic";

const bodySchema = z.object({ on: z.boolean() });

/**
 * PUT /api/production/batches/:batchId/fabric-first — { on }. Fabric first for the batch:
 * its fabric is booked once each style's fabric part is locked. Needs production.bookings.approve.
 */
export const PUT = apiRoute<Params>(async (request, { batchId }) => {
  const { on } = bodySchema.parse(await readJson(request));
  return bookings.setFabricFirst(
    await requirePermission("production.bookings.approve"),
    batchId,
    on,
    await getRequestMeta(),
  );
});
