import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as cutting from "@/modules/production/cutting.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/projects/:projectId/fabric-faults — { materialId, supplierId, quantity,
 * amount?, photoId?, note }: a Fabric Fault Note, faulty fabric of the style found at cutting,
 * into the supplier's fault log to deduct (production.manage or materials.purchase).
 */
export const POST = apiRoute<Params>(
  async (request, { projectId }) =>
    cutting.fabricFaultNote(
      await requireAnyPermission("production.manage", "materials.purchase"),
      projectId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
