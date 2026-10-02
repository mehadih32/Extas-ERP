import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as vouchers from "@/modules/accounts/voucher.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/transfers — { fromAccountId, toAccountId, amount, date?, reference?, notes? }:
 * money moved between cash, bank and wallet accounts (Accounts only).
 */
export const POST = apiRoute(
  async (request) =>
    vouchers.createTransfer(
      await requirePermission("accounts.payments.record"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
