import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as purchases from "@/modules/materials/purchase.service";

type Params = { billId: string };

export const dynamic = "force-dynamic";

/** GET /api/materials/purchases/:billId — the goods, what went back, payments and balance due. */
export const GET = apiRoute<Params>(async (_request, { billId }) =>
  purchases.getPurchase(await requirePermission("materials.view"), billId),
);
