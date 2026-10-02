import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as costs from "@/modules/production/cost.service";

type Params = { billId: string };

export const dynamic = "force-dynamic";

/** GET /api/production/bills/:billId — split lines per project, payments, balance due. */
export const GET = apiRoute<Params>(async (_request, { billId }) =>
  costs.getBill(await requirePermission("production.view"), billId),
);
