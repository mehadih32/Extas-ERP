import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as intakes from "@/modules/production/intake.service";

type Params = { intakeId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/intakes/:intakeId/confirm — { warehouseId?, totalCost?, finalDelivery?,
 * completeProject?, allowZeroCost? }. Puts the pieces into stock (A and B grade), moves their
 * share of the project cost from WIP into inventory and updates average costs.
 */
export const POST = apiRoute<Params>(async (request, { intakeId }) =>
  intakes.confirmIntake(
    await requirePermission("production.stock_intake"),
    intakeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
