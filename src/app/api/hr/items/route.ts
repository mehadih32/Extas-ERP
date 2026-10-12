import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/hr/asset.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/items?show=out|returned|all&employeeId=&q= — company items with staff (laptops,
 * phones, SIMs, ID cards...), those still out by default.
 */
export const GET = apiRoute(async (request) =>
  assets.listAssets(
    await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/hr/items — { employeeId, name, kind?, tag?, value?, issuedOn, note? }: gives an
 * employee a company item; they are told in the app.
 */
export const POST = apiRoute(
  async (request) =>
    assets.issueAsset(
      await requirePermission("hr.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
