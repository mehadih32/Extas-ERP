import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as matrix from "@/modules/inventory/matrix.service";

export const dynamic = "force-dynamic";

/** GET /api/inventory/lookup?code= — find a SKU by barcode or SKU, with its stock. */
export const GET = apiRoute(async (request) =>
  matrix.lookupVariant(
    await requirePermission("inventory.view"),
    new URL(request.url).searchParams.get("code") ?? "",
  ),
);
