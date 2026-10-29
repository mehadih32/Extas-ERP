import { z } from "zod";

/*
 * A sold copy's web address, as it says it at its claim and daily check-in
 * (extas-client.ts, copies.service.ts): kept as its origin only, so
 * "https://ERP.shop.com/" and "https://erp.shop.com" are one address (a blocked
 * address stays blocked). HTTPS only, except a copy on this very computer.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The origin of a copy's address, or null when it is not one a copy may give. */
export function copyOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

export const copyAddressSchema = z
  .string()
  .max(300, "The address is too long")
  .transform((raw, ctx) => {
    const origin = copyOrigin(raw);
    if (!origin) {
      ctx.addIssue({ code: "custom", message: "Give the copy's web address (https://...)" });
      return z.NEVER;
    }
    return origin;
  });
