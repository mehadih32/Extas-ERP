import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as documents from "@/modules/sales/documents.service";

type Params = { orderId: string };

export const dynamic = "force-dynamic";

/** POST /api/sales/orders/:orderId/challans — { vehicleNo?, driverName?, items? }; stock leaves here. */
export const POST = apiRoute<Params>(
  async (request, { orderId }) =>
    documents.createDeliveryChallan(
      await requirePermission("sales.order.create"),
      orderId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
