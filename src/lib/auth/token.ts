import { createHash, randomBytes } from "node:crypto";

/** 256-bit random session token sent to the browser in an httpOnly cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored in the database, so a DB leak cannot hijack sessions. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
