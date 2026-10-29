import { apiRoute, readJson } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientAddress } from "@/lib/request-meta";
import { checkInCopy } from "@/modules/backups/copies.service";

/**
 * POST /api/v1/extas-client/check-in: a sold copy's daily check-in (its address and
 * whether its Drive is connected); answers whether it may keep the Google client.
 */
export const POST = apiRoute(async (request) => {
  checkRateLimit(`extas-client:${clientAddress(request.headers) ?? "unknown"}`, 5, 60_000);
  return checkInCopy(await readJson(request));
});
