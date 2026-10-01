import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as parties from "@/modules/parties/party.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/parties?kind=BUYER|SUPPLIER&buyerType=&grade=&status=&verified=&city=
 *   &search=&withBalance=&cursor=&take=
 */
export const GET = apiRoute(async (request) =>
  parties.listParties(
    await requirePermission("parties.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/** POST /api/parties — { kind, name, buyerType?, phone?, whatsapp?, email?, grade?, creditLimit?... } */
export const POST = apiRoute(
  async (request) =>
    parties.createParty(
      await requirePermission("parties.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
