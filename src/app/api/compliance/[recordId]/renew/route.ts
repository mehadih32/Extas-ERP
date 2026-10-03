import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";

type Params = { recordId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/compliance/:recordId/renew — { expiryDate, issueDate?, number?, issuingAuthority?,
 * title?, alertDaysBefore?, notes? }: the next term. The old record stays as history and its
 * alerts stop.
 */
export const POST = apiRoute<Params>(
  async (request, { recordId }) =>
    compliance.renewCompliance(
      await requirePermission("compliance.manage"),
      recordId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
