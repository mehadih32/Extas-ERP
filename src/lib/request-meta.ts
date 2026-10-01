import "server-only";

import { headers } from "next/headers";

export type RequestMeta = { ipAddress?: string; userAgent?: string };

/** Client IP and user agent for sessions and the audit log. */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: forwarded || h.get("x-real-ip") || undefined,
    userAgent: h.get("user-agent")?.slice(0, 500) || undefined,
  };
}
