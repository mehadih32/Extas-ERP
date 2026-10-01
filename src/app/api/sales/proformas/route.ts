import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as proformas from "@/modules/sales/proforma.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/proformas?status=&partyId=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  proformas.listProformas(
    await requirePermission("sales.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
