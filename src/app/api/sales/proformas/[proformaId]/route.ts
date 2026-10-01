import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as proformas from "@/modules/sales/proforma.service";

type Params = { proformaId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/proformas/:proformaId — with advance due, payments and production. */
export const GET = apiRoute<Params>(async (_request, { proformaId }) =>
  proformas.getProforma(await requirePermission("sales.view"), proformaId),
);
