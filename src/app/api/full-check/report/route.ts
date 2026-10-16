import { apiRoute, readJson } from "@/lib/api";
import { receiveReport } from "@/modules/ai/full-check/full-check.service";

export const dynamic = "force-dynamic";

const keyOf = (request: Request) =>
  request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim() ?? "";

/**
 * POST /api/full-check/report — the Full check's report (Authorization: Bearer
 * <report key>): what it opened and every problem. The answer names the problems
 * whose screenshots come next (/api/full-check/shot).
 */
export const POST = apiRoute(async (request) =>
  receiveReport(keyOf(request), await readJson(request)),
);
