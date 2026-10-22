import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Signing for both directions of the e-commerce API (CN-005): the sender puts
 * `X-Extas-Signature: sha256=<hex HMAC-SHA256 of the raw body>` and
 * `X-Extas-Timestamp: <Unix seconds>` on the request, with the integration's
 * webhook secret as the HMAC key. A request whose time is more than five
 * minutes away from now is refused.
 */

export const SIGNATURE_HEADER = "x-extas-signature";
export const TIMESTAMP_HEADER = "x-extas-timestamp";
export const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

/** The X-Extas-Signature value for a body. */
export function signBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** Whether a signature header matches the body (compared in constant time). */
export function signatureMatches(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(signBody(secret, rawBody));
  const given = Buffer.from(header.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Whether X-Extas-Timestamp is a time within five minutes of now. */
export function timestampFresh(header: string | null, now: Date = new Date()): boolean {
  if (!header || !/^\d{1,12}$/.test(header.trim())) return false;
  const seconds = Number(header.trim());
  return Math.abs(now.getTime() / 1000 - seconds) <= MAX_CLOCK_SKEW_SECONDS;
}

/** The two headers a sender adds (the ERP's own webhooks, and tests). */
export function signedHeaders(secret: string, rawBody: string, now: Date = new Date()) {
  return {
    "X-Extas-Signature": signBody(secret, rawBody),
    "X-Extas-Timestamp": String(Math.floor(now.getTime() / 1000)),
  };
}
