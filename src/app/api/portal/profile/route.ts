import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as vault from "@/modules/hr/vault.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/profile — your own details, what is missing, your papers and how you are paid,
 * with your pay detail change (waiting, or the last one HR decided).
 */
export const GET = apiRoute(async () => vault.getMyVault(await requirePermission("portal.self")));

/**
 * PATCH /api/portal/profile — { nid?, dateOfBirth?, bloodGroup?, whatsapp?, email?, address?,
 * emergencyContact?, referenceName?, referencePhone?, referenceRelation? }. The national ID, date
 * of birth and blood group are filled once; HR changes them after that.
 */
export const PATCH = apiRoute(async (request) =>
  vault.updateMyDetails(
    await requirePermission("portal.self"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
