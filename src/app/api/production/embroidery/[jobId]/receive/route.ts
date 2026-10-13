import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as cutting from "@/modules/production/cutting.service";

type Params = { jobId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/embroidery/:jobId/receive — { receivedOn?, lines: [{ colorName?,
 * sizeName?, received, spoiled }] }: pieces back from embroidery or print, good and spoiled,
 * a little at a time if need be (production.manage).
 */
export const POST = apiRoute<Params>(async (request, { jobId }) =>
  cutting.receiveFromEmbroidery(
    await requirePermission("production.manage"),
    jobId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
