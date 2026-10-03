import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";

type Params = { recordId: string };

export const dynamic = "force-dynamic";

/** POST /api/compliance/:recordId/archive — takes it off the list and stops its alerts. */
export const POST = apiRoute<Params>(async (_request, { recordId }) =>
  compliance.archiveCompliance(
    await requirePermission("compliance.manage"),
    recordId,
    await getRequestMeta(),
  ),
);
