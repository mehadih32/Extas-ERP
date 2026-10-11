import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as terms from "@/modules/hr/terms.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/terms/publish — { askEveryone?: boolean }: publishes the draft as the next
 * version. The first version, and any with askEveryone (the default), must be agreed to by
 * every current employee with a login before they work in the app again.
 */
export const POST = apiRoute(async (request) =>
  terms.publishTerms(
    await requirePermission("hr.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
