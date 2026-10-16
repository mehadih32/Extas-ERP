import "server-only";

import { isIP } from "node:net";

import { headers } from "next/headers";

export type RequestMeta = { ipAddress?: string; userAgent?: string };

/**
 * The visitor's address. Caddy (deploy/Caddyfile) settles it, also behind
 * Cloudflare's proxy, and hands it on as the only X-Forwarded-For entry; the
 * app is never reached any other way. Only a real address counts: anything
 * else a header carries is ignored.
 */
export function clientAddress(h: Pick<Headers, "get">): string | undefined {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  for (const address of [forwarded, h.get("x-real-ip")?.trim()]) {
    if (address && isIP(address)) return address;
  }
  return undefined;
}

/** Client IP and user agent for sessions and the audit log. */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ipAddress: clientAddress(h),
    userAgent: h.get("user-agent")?.slice(0, 500) || undefined,
  };
}
