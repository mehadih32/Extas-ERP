import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as ledger from "@/modules/hr/ledger.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/ledger — your money: each approved month's salary line by line (basic + approved
 * overtime + claims - absence - advance EMI = take-home), the parts paid, and what is still owed
 * either way.
 */
export const GET = apiRoute(async () => ledger.myMoney(await requirePermission("portal.self")));
