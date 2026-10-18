import "server-only";

import { isIP } from "node:net";

import { headers } from "next/headers";

import { isCloudflareAddress } from "@/lib/cloudflare-ips";

export type RequestMeta = { ipAddress?: string; userAgent?: string };

/**
 * The visitor's address. Caddy (deploy/Caddyfile) settles it, also behind
 * Cloudflare's proxy, and hands it on as the only X-Forwarded-For entry; the
 * app is never reached any other way. Only a real address counts: anything
 * else a header carries is ignored. When the address Caddy handed on is one of
 * Cloudflare's own (its list on the server was older than Cloudflare's), the
 * request really came through Cloudflare, which names the visitor in
 * CF-Connecting-IP: that address is taken (v6.4.1 B2). From anywhere else
 * CF-Connecting-IP is never believed. A Cloudflare address that names nobody
 * is kept for the logs only: visitorAddress() never blocks or counts it.
 */
export function clientAddress(h: Pick<Headers, "get">): string | undefined {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  let address: string | undefined;
  for (const candidate of [forwarded, h.get("x-real-ip")?.trim()]) {
    if (candidate && isIP(candidate)) {
      address = candidate;
      break;
    }
  }
  if (address && isCloudflareAddress(address)) {
    const visitor = h.get("cf-connecting-ip")?.trim();
    if (visitor && isIP(visitor) && !isCloudflareAddress(visitor)) return visitor;
  }
  return address;
}

/** Client IP and user agent for sessions and the audit log. */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ipAddress: clientAddress(h),
    userAgent: h.get("user-agent")?.slice(0, 500) || undefined,
  };
}
