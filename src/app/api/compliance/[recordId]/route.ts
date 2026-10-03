import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";

type Params = { recordId: string };

export const dynamic = "force-dynamic";

/** GET /api/compliance/:recordId — the record with its earlier terms. */
export const GET = apiRoute<Params>(async (_request, { recordId }) =>
  compliance.getCompliance(
    await requireAnyPermission("compliance.view", "compliance.manage"),
    recordId,
  ),
);

/**
 * PATCH /api/compliance/:recordId — corrects { type?, title?, number?, issuingAuthority?,
 * issueDate?, expiryDate?, alertDaysBefore?, notes? }. For a new term use /renew.
 */
export const PATCH = apiRoute<Params>(async (request, { recordId }) =>
  compliance.updateCompliance(
    await requirePermission("compliance.manage"),
    recordId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/**
 * DELETE /api/compliance/:recordId — removes a record entered by mistake (with its scan);
 * deleting a renewal puts the term before it back in force.
 */
export const DELETE = apiRoute<Params>(async (_request, { recordId }) =>
  compliance.deleteCompliance(
    await requirePermission("compliance.manage"),
    recordId,
    await getRequestMeta(),
  ),
);
