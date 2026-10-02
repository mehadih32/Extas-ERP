import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as vouchers from "@/modules/accounts/voucher.service";

type Params = { entryId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/journal/:entryId/reverse — { reason, date? }: reverses a journal voucher
 * (accounts.manage) or a transfer (accounts.payments.record) with a mirror entry.
 */
export const POST = apiRoute<Params>(
  async (request, { entryId }) =>
    vouchers.reverseJournalVoucher(
      await requireAnyPermission("accounts.manage", "accounts.payments.record"),
      entryId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
