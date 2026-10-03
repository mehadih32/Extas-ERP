import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as intakes from "@/modules/production/intake.service";

type Params = { intakeId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/intakes/:intakeId/reverse — { reason, redraft? }. Undoes a confirmed
 * delivery: its pieces leave stock, its cost goes back to the project (a completed project is
 * reopened) and average costs are restored. `redraft` opens a draft copy to correct and confirm
 * again. Refused while the warehouse holds fewer free pieces of any of its SKUs and grades
 * than the delivery brought in (sold, reserved or moved to bad stock since).
 */
export const POST = apiRoute<Params>(async (request, { intakeId }) =>
  intakes.reverseIntake(
    await requirePermission("production.manage"),
    intakeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
