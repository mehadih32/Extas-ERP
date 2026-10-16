import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { shotOf } from "@/modules/ai/full-check/full-check.service";
import { requireCompany } from "@/modules/auth/context";

type Params = { problemId: string };

export const dynamic = "force-dynamic";

/** GET /api/full-check/shots/:problemId — a Full check problem's screenshot (the platform owner's). */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  try {
    const { problemId } = await context.params;
    const shot = await shotOf(await requireCompany(), problemId);
    return fileResponse(shot, "inline");
  } catch (error) {
    return apiErrorResponse(error);
  }
}
