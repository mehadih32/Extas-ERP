import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as capital from "@/modules/accounts/capital.service";

type Params = { sourceId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/capital/:sourceId/schedule/preview — the same body: the installments
 * without saving them.
 */
export const POST = apiRoute<Params>(async (request, { sourceId }) =>
  capital.previewSchedule(
    await requirePermission("accounts.view"),
    sourceId,
    await readJson(request),
  ),
);
