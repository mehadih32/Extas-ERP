import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as proformas from "@/modules/sales/proforma.service";

type Params = { proformaId: string };

export const dynamic = "force-dynamic";

/** POST /api/sales/proformas/:proformaId/convert — make the sales order { lines | matrix, ... } */
export const POST = apiRoute<Params>(
  async (request, { proformaId }) =>
    proformas.convertProformaToOrder(
      await requirePermission("sales.order.create"),
      proformaId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
