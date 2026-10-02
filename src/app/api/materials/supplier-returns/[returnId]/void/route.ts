import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as returns from "@/modules/materials/supplier-return.service";

type Params = { returnId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/materials/supplier-returns/:returnId/void — { reason }. The goods come back into the
 * store and the supplier's credit is reversed. Needs materials.purchase or accounts.manage.
 */
export const POST = apiRoute<Params>(async (request, { returnId }) =>
  returns.voidSupplierReturn(
    await requireAnyPermission("materials.purchase", "accounts.manage"),
    returnId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
