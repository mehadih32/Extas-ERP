import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as capital from "@/modules/accounts/capital.service";

type Params = { installmentId: string };

export const dynamic = "force-dynamic";

/** POST /api/accounts/installments/:installmentId/skip — { reason }. */
export const POST = apiRoute<Params>(async (request, { installmentId }) =>
  capital.skipInstallment(
    await requirePermission("accounts.manage"),
    installmentId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
