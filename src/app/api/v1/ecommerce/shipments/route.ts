import { ecommerceRoute } from "@/modules/ecommerce/route";
import { createShipment } from "@/modules/ecommerce/shipments.service";

/** POST /api/v1/ecommerce/shipments: the parcel the shop booked for an order. */
export const POST = ecommerceRoute((call) => createShipment(call, call.body), {
  successStatus: 201,
});
