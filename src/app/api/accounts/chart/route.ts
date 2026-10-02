import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as chart from "@/modules/accounts/chart.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/chart?type=&subType=&includeInactive=&search=&asOf= — accounts with balances. */
export const GET = apiRoute(async (request) =>
  chart.listAccounts(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/** POST /api/accounts/chart — { name, subType, code? }: a new account (next free code if none). */
export const POST = apiRoute(
  async (request) =>
    chart.createAccount(
      await requirePermission("accounts.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
