import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as advances from "@/modules/hr/advance.service";

export const dynamic = "force-dynamic";

/** GET /api/portal/advances — your advances and how they were recovered. */
export const GET = apiRoute(async () =>
  advances.myAdvances(await requirePermission("portal.self")),
);
