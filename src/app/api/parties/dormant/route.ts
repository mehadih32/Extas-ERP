import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as dormant from "@/modules/parties/dormant.service";

export const dynamic = "force-dynamic";

/** GET /api/parties/dormant?months=6|12&buyerTypes=WHOLESALE,B2B_CORPORATE */
export const GET = apiRoute(async (request) =>
  dormant.listDormantBuyers(
    await requirePermission("parties.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
