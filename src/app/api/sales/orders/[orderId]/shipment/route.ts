import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as orders from "@/modules/sales/order.service";

type Params = { orderId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/orders/:orderId/shipment — { shipmentDate: "2026-11-20" | null }: sets, moves or
 * clears the day an open order is due to ship. Shipment reminders follow it.
 */
export const POST = apiRoute<Params>(async (request, { orderId }) =>
  orders.setOrderShipmentDate(
    await requirePermission("sales.order.create"),
    orderId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
