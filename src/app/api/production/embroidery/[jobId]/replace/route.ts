import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as cutting from "@/modules/production/cutting.service";

type Params = { jobId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/embroidery/:jobId/replace — { cutOn?, lines: [{ colorName?, sizeName?,
 * quantity }], logFault? }: Replace from cutting, a replacement cutting report for pieces
 * spoiled there, alerting Production; with logFault, the spoiled pieces also go into the
 * embroidery or print house's fault log (production.manage).
 */
export const POST = apiRoute<Params>(
  async (request, { jobId }) =>
    cutting.replaceFromCutting(
      await requirePermission("production.manage"),
      jobId,
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
