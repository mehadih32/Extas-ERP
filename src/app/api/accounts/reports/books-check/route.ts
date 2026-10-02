import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/accounts/reports.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/reports/books-check — do the ledgers agree with stock, assets and loans? */
export const GET = apiRoute(async () =>
  reports.getBooksCheck(await requirePermission("accounts.view")),
);
