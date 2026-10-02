import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as intakes from "@/modules/production/intake.service";

type Params = { intakeId: string };

export const dynamic = "force-dynamic";

/** POST /api/production/intakes/:intakeId/parse — (re)read the packing list with AI. */
export const POST = apiRoute<Params>(async (_request, { intakeId }) =>
  intakes.parseIntake(
    await requirePermission("production.stock_intake"),
    intakeId,
    await getRequestMeta(),
  ),
);
