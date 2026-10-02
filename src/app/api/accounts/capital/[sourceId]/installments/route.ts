import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as capital from "@/modules/accounts/capital.service";

type Params = { sourceId: string };

export const dynamic = "force-dynamic";

/** POST /api/accounts/capital/:sourceId/installments — { dueDate, principalPart, interestPart, note? }. */
export const POST = apiRoute<Params>(
  async (request, { sourceId }) =>
    capital.addInstallment(
      await requirePermission("accounts.manage"),
      sourceId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
