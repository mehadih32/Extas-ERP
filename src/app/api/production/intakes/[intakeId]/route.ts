import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as intakes from "@/modules/production/intake.service";

type Params = { intakeId: string };

export const dynamic = "force-dynamic";

/** GET /api/production/intakes/:intakeId — lines, AI reading notes and the cost preview. */
export const GET = apiRoute<Params>(async (_request, { intakeId }) =>
  intakes.getIntake(
    await requireAnyPermission("production.view", "production.stock_intake"),
    intakeId,
  ),
);

/** PATCH /api/production/intakes/:intakeId — correct a draft (lines, warehouse, costing). */
export const PATCH = apiRoute<Params>(async (request, { intakeId }) =>
  intakes.updateIntake(
    await requirePermission("production.stock_intake"),
    intakeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
