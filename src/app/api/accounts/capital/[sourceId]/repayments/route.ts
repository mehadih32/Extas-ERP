import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as capital from "@/modules/accounts/capital.service";

type Params = { sourceId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/capital/:sourceId/repayments — { principal, interest, date?, method?,
 * accountId?, reference?, notes? }: money out outside the schedule (owners: withdrawals, drawings).
 */
export const POST = apiRoute<Params>(
  async (request, { sourceId }) =>
    capital.repayCapital(
      await requirePermission("accounts.manage"),
      sourceId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
