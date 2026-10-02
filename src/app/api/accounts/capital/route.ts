import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as capital from "@/modules/accounts/capital.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/capital?kind=&status= — owners' capital, investors and loans with totals. */
export const GET = apiRoute(async (request) =>
  capital.listCapitalSources(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/accounts/capital — { kind: OWNER_CAPITAL | INVESTOR | BANK_LOAN | PRIVATE_LOAN, name,
 * contact?, interestRate?, profitSharePct?, startDate?, maturityDate?, notes?, received?: { amount,
 * method, accountId?, reference? } | opening?: { amount, asOf? } }. Money received also needs
 * accounts.receipts.record.
 */
export const POST = apiRoute(
  async (request) =>
    capital.createCapitalSource(
      await requirePermission("accounts.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
