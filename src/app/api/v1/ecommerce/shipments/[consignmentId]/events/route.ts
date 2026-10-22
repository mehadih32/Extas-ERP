import { ecommerceRoute } from "@/modules/ecommerce/route";
import { addShipmentEvent } from "@/modules/ecommerce/shipments.service";

/** POST /api/v1/ecommerce/shipments/{consignmentId}/events: a courier's status for the parcel. */
export const POST = ecommerceRoute<{ consignmentId: string }>(
  (call, { consignmentId }) => addShipmentEvent(call, consignmentId, call.body),
  { successStatus: 201 },
);
