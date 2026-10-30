import { apiRoute, readJson } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientAddress } from "@/lib/request-meta";
import { claimClient } from "@/modules/backups/copies.service";

/**
 * POST /api/v1/extas-client/claim: a sold copy of the ERP asks for this server's
 * Google client with its copy code (or its own name and secret). No sign-in: the
 * caller is another server. A few tries a minute per address (copies.service.ts).
 */
export const POST = apiRoute(async (request) => {
  checkRateLimit(`extas-client:${clientAddress(request.headers) ?? "unknown"}`, 5, 60_000);
  return claimClient(await readJson(request));
});
