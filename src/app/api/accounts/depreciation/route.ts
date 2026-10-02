import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/accounts/asset.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/depreciation?through=YYYY-MM-DD — what a depreciation run would post. */
export const GET = apiRoute(async (request) =>
  assets.previewDepreciation(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/accounts/depreciation — { through? }: posts depreciation up to that day
 * (default: the end of last month). Running it twice posts nothing new.
 */
export const POST = apiRoute(async (request) =>
  assets.runDepreciation(
    await requirePermission("accounts.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
