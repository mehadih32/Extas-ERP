import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as capital from "@/modules/accounts/capital.service";

type Params = { sourceId: string };

export const dynamic = "force-dynamic";

/** GET /api/accounts/capital/:sourceId — totals, installments and its ledger. */
export const GET = apiRoute<Params>(async (_request, { sourceId }) =>
  capital.getCapitalSource(await requirePermission("accounts.view"), sourceId),
);

/** PATCH /api/accounts/capital/:sourceId — details, rates, maturity, status (ACTIVE / DEFAULTED). */
export const PATCH = apiRoute<Params>(async (request, { sourceId }) =>
  capital.updateCapitalSource(
    await requirePermission("accounts.manage"),
    sourceId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
