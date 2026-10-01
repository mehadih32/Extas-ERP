import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as orders from "@/modules/sales/order.service";

type Params = { orderId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/orders/:orderId — lines with delivered / remaining, documents, payments. */
export const GET = apiRoute<Params>(async (_request, { orderId }) =>
  orders.getOrder(await requirePermission("sales.view"), orderId),
);

/** PATCH /api/sales/orders/:orderId — edit before delivery and invoicing. */
export const PATCH = apiRoute<Params>(async (request, { orderId }) =>
  orders.updateOrder(
    await requirePermission("sales.order.create"),
    orderId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
