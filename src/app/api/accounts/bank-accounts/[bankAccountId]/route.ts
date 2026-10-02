import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as bank from "@/modules/accounts/bank.service";

type Params = { bankAccountId: string };

export const dynamic = "force-dynamic";

/** GET /api/accounts/bank-accounts/:bankAccountId — details and balance. */
export const GET = apiRoute<Params>(async (_request, { bankAccountId }) =>
  bank.getBankAccount(await requirePermission("accounts.view"), bankAccountId),
);

/**
 * PATCH /api/accounts/bank-accounts/:bankAccountId — edit details; isActive: false closes it
 * (only at a zero balance).
 */
export const PATCH = apiRoute<Params>(async (request, { bankAccountId }) =>
  bank.updateBankAccount(
    await requirePermission("accounts.manage"),
    bankAccountId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
