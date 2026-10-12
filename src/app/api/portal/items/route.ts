import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/hr/asset.service";

export const dynamic = "force-dynamic";

/** GET /api/portal/items — the company items you hold now, and those you gave back. */
export const GET = apiRoute(async () => assets.myAssets(await requirePermission("portal.self")));
