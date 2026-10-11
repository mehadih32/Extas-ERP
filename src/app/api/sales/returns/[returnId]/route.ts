import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as salesReturns from "@/modules/sales/return.service";

type Params = { returnId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/returns/:returnId — credit note. */
export const GET = apiRoute<Params>(async (_request, { returnId }) =>
  salesReturns.getSalesReturn(await requirePermission("sales.view"), returnId),
);
