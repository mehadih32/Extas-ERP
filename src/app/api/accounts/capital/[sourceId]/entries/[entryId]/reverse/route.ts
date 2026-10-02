import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as capital from "@/modules/accounts/capital.service";

type Params = { sourceId: string; entryId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/capital/:sourceId/entries/:entryId/reverse — { reason, date? }: undoes a
 * receipt or payment entered by mistake.
 */
export const POST = apiRoute<Params>(async (request, { sourceId, entryId }) =>
  capital.reverseCapitalEntry(
    await requirePermission("accounts.manage"),
    sourceId,
    entryId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
