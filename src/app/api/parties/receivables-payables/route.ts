import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as ledger from "@/modules/parties/ledger.service";

export const dynamic = "force-dynamic";

/** GET /api/parties/receivables-payables — totals plus per-party breakdown. */
export const GET = apiRoute(async () =>
  ledger.getReceivablesPayables(await requirePermission("parties.ledger.view")),
);
