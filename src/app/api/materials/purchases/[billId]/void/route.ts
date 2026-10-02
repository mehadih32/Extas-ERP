import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as purchases from "@/modules/materials/purchase.service";

type Params = { billId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/materials/purchases/:billId/void — { reason }. Takes the goods back out of the store
 * and reverses the bill; money already paid stays with the supplier as an advance. Refused once
 * the goods have been used or returned. Needs materials.purchase or accounts.manage.
 */
export const POST = apiRoute<Params>(async (request, { billId }) =>
  purchases.voidPurchase(
    await requireAnyPermission("materials.purchase", "accounts.manage"),
    billId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
