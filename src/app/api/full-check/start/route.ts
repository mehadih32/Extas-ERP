import { apiRoute, readJson } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { beginCheck } from "@/modules/ai/full-check/full-check.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/full-check/start — GitHub's Full check (.github/workflows/full-check.yml)
 * gives the one-time pass the ERP sent it, and gets its sessions (the owner and
 * one member of each role) and the key to send its report with. A pass works once.
 */
export const POST = apiRoute(async (request) => {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  checkRateLimit(`full-check-start:${ip}`, 10, 60_000);
  return beginCheck(await readJson(request));
});
