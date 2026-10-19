import { z } from "zod";

import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import { TECH_PACK_READ } from "@/modules/production/tech-pack-access";
import * as techPacks from "@/modules/production/tech-pack-approval.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/tech-pack/approval — where the style's tech pack
 * stands: draft or approved, its fabric part locked or not, and what changed since.
 * Needs production.view, or approving tech packs or their logos (TECH_PACK_READ).
 */
export const GET = apiRoute<Params>(async (_request, { projectId }) =>
  techPacks.getTechPack(await requireAnyPermission(...TECH_PACK_READ), projectId),
);

const bodySchema = z.object({ action: z.enum(["lock-fabric", "approve", "approve-trims"]) });

/**
 * POST /api/production/projects/:projectId/tech-pack/approval — { action: "lock-fabric" }
 * locks the fabric part (Fabric first); { action: "approve" } approves the tech pack;
 * { action: "approve-trims" } approves its trims (trims, collar, cuff) again after they
 * changed since approval. Needs production.techpack.approve.
 */
export const POST = apiRoute<Params>(async (request, { projectId }) => {
  const { action } = bodySchema.parse(await readJson(request));
  const ctx = await requirePermission("production.techpack.approve");
  const meta = await getRequestMeta();
  if (action === "approve") return techPacks.approveTechPack(ctx, projectId, meta);
  if (action === "approve-trims") return techPacks.approveTrimsPart(ctx, projectId, meta);
  return techPacks.lockFabricPart(ctx, projectId, meta);
});
