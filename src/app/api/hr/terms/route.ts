import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as terms from "@/modules/hr/terms.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/terms?version=2 — the terms of employment for HR: the version in force,
 * the draft (hr.manage), earlier versions (one in full when asked for) and where each
 * current employee stands (agreed, to agree, no login), with their signed copy.
 */
export const GET = apiRoute(async (request) =>
  terms.getTermsScreen(await requireAnyPermission("hr.view", "hr.manage", "hr.payroll"), {
    version: new URL(request.url).searchParams.get("version") ?? undefined,
  }),
);
