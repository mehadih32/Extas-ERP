import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { requireAnyPermission } from "@/modules/auth/context";
import { TECH_PACK_READ } from "@/modules/production/tech-pack-access";
import { logoMachineFile } from "@/modules/production/tech-pack-files.service";

type Params = { techPackId: string; logoId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/tech-packs/:techPackId/logos/:logoId/file?format=DST|EXP — the logo's machine
 * file as stored, or turned into DST or EXP for another machine (from the same master).
 * Always a download.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { techPackId, logoId } = await context.params;
    const ctx = await requireAnyPermission(...TECH_PACK_READ);
    const asked = new URL(request.url).searchParams.get("format")?.toUpperCase();
    const format = asked === "DST" || asked === "EXP" ? asked : null;
    return fileResponse(await logoMachineFile(ctx, techPackId, logoId, format));
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
