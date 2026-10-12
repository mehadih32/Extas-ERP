import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as claims from "@/modules/hr/claims.service";

export const dynamic = "force-dynamic";

/** GET /api/portal/claims — your claims, what is owed to you and what waits. */
export const GET = apiRoute(async () => claims.getMyClaims(await requirePermission("portal.self")));

/**
 * POST /api/portal/claims — { kind: "CONVEYANCE", date, amount, fromPlace, toPlace, purpose,
 * receiptFileId? } or { kind: "LOCAL_MATERIAL", date, amount, projectId, item, quantity?, shop?,
 * purpose?, receiptFileId? }: claims money back from Accounts.
 */
export const POST = apiRoute(
  async (request) =>
    claims.submitClaim(
      await requirePermission("portal.self"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
