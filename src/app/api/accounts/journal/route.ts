import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as vouchers from "@/modules/accounts/voucher.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/journal?sourceType=&accountId=&search=&from=&to=&cursor=&take= — the day book. */
export const GET = apiRoute(async (request) =>
  vouchers.listJournalEntries(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/accounts/journal — { date?, description, lines: [{ accountId, debit? | credit?,
 * partyId?, memo? }] }: a journal voucher (debits = credits).
 */
export const POST = apiRoute(
  async (request) =>
    vouchers.createJournalVoucher(
      await requirePermission("accounts.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
