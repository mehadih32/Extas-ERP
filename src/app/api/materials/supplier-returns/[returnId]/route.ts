import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as returns from "@/modules/materials/supplier-return.service";

type Params = { returnId: string };

export const dynamic = "force-dynamic";

/** GET /api/materials/supplier-returns/:returnId — the debit note and its lines. */
export const GET = apiRoute<Params>(async (_request, { returnId }) =>
  returns.getSupplierReturn(await requirePermission("materials.view"), returnId),
);
