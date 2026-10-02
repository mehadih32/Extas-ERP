import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as advances from "@/modules/hr/advance.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/advances?employeeId=&status=OPEN|SETTLED|VOID&cursor=&take= — advances and what is
 * still owed.
 */
export const GET = apiRoute(async (request) =>
  advances.listAdvances(
    await requireAnyPermission(
      "hr.manage",
      "hr.payroll",
      "accounts.view",
      "accounts.payments.record",
    ),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/hr/advances — { employeeId, amount, date?, method?, accountId?, reference?, purpose?,
 * installmentAmount?, recoverFrom?, isOpening? }: Accounts pays an advance (or brings one forward).
 */
export const POST = apiRoute(
  async (request) =>
    advances.giveAdvance(
      await requireAnyPermission("accounts.payments.record", "accounts.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
