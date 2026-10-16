import { apiRoute } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { MAX_SHOT_BYTES, receiveShot } from "@/modules/ai/full-check/full-check.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/full-check/shot?problem=<id> — one problem's screenshot (a JPEG or PNG
 * body), with the report key (Authorization: Bearer <key>), soon after the report.
 */
export const POST = apiRoute(async (request) => {
  const key =
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ?? "";
  const problem = new URL(request.url).searchParams.get("problem") ?? "";
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > MAX_SHOT_BYTES) throw new AppError("VALIDATION", "The screenshot is too big.");
  await receiveShot(key, problem.slice(0, 40), Buffer.from(await request.arrayBuffer()));
  return { saved: true };
});
