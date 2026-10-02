import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as bank from "@/modules/accounts/bank.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/bank-accounts?includeInactive= — bank accounts with balances. */
export const GET = apiRoute(async (request) =>
  bank.listBankAccounts(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/accounts/bank-accounts — { bankName, branch?, accountName, accountNumber,
 * routingNumber?, swiftCode?, openingBalance?, openingDate? }.
 */
export const POST = apiRoute(
  async (request) =>
    bank.createBankAccount(
      await requirePermission("accounts.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
