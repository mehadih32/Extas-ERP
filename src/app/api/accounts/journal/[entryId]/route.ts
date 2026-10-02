import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as vouchers from "@/modules/accounts/voucher.service";

type Params = { entryId: string };

export const dynamic = "force-dynamic";

/** GET /api/accounts/journal/:entryId — one entry with its lines. */
export const GET = apiRoute<Params>(async (_request, { entryId }) =>
  vouchers.getJournalEntry(await requirePermission("accounts.view"), entryId),
);
