import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/accounts/asset.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/assets?status=&category=&search= — the fixed asset register with totals. */
export const GET = apiRoute(async (request) =>
  assets.listFixedAssets(
    await requirePermission("accounts.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/accounts/assets — { name, category?, location?, purchaseDate, purchaseCost,
 * depreciationRate?, depreciationMethod?, salvageValue?, acquisition: { kind: "PAID", method,
 * accountId?, reference? } | { kind: "CREDIT", supplierId, supplierRef? } | { kind: "OPENING",
 * accumulatedDepreciation, asOf? } }. Paid now also needs accounts.payments.record.
 */
export const POST = apiRoute(
  async (request) =>
    assets.createFixedAsset(
      await requirePermission("accounts.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
