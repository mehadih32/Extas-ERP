import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as quotations from "@/modules/sales/quotation.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/quotations?status=&partyId=&search=&from=&to=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  quotations.listQuotations(
    await requirePermission("sales.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/** POST /api/sales/quotations — { partyId, items, stylingRules?, discount?, tax?, customFields?... } */
export const POST = apiRoute(
  async (request) =>
    quotations.createQuotation(
      await requirePermission("sales.quotation.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
