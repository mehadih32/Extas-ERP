import { apiRoute, readJson } from "@/lib/api";
import { visitorAddress } from "@/lib/cloudflare-ips";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientAddress } from "@/lib/request-meta";
import { beginCheck } from "@/modules/ai/full-check/full-check.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/full-check/start — GitHub's Full check (.github/workflows/full-check.yml)
 * gives the one-time pass the ERP sent it, and gets its sessions (the owner and
 * one member of each role) and the key to send its report with. A pass works once.
 */
export const POST = apiRoute(async (request) => {
  // A Cloudflare address is no one visitor (v6.4.1 B2).
  const ip = visitorAddress(clientAddress(request.headers)) ?? "unknown";
  checkRateLimit(`full-check-start:${ip}`, 10, 60_000);
  return beginCheck(await readJson(request));
});
