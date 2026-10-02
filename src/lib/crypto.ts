import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { AppError } from "@/lib/errors";

/*
 * Secrets kept in the database (the Google Drive refresh token now; courier and
 * WhatsApp keys later) are sealed with AES-256-GCM under ENCRYPTION_KEY, and
 * small payloads that travel through the browser (OAuth state) are signed.
 * Read at call time so tests and a changed .env take effect.
 */

function secret(): string {
  const value = process.env.ENCRYPTION_KEY;
  if (!value || value.length < 16) {
    throw new AppError(
      "UNAVAILABLE",
      "ENCRYPTION_KEY is not set on the server (generate one with: openssl rand -base64 32).",
    );
  }
  return value;
}

/** Separate 32-byte keys for sealing and signing, both derived from ENCRYPTION_KEY. */
const key = (purpose: "seal" | "sign") =>
  createHash("sha256").update(`${purpose}:${secret()}`).digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("seal"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")}`;
}

export function decryptSecret(sealed: string): string {
  const [version, payload] = sealed.split(":");
  if (version !== "v1" || !payload) {
    throw new AppError("INTERNAL", "Stored secret is in an unknown format.");
  }
  const raw = Buffer.from(payload, "base64url");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key("seal"), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError(
      "UNAVAILABLE",
      "A stored secret could not be unlocked (was ENCRYPTION_KEY changed?). Connect the service again.",
    );
  }
}

/** `payload.signature`, both base64url; the payload carries its own expiry. */
export function signPayload(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString("base64url");
  const signature = createHmac("sha256", key("sign")).update(body).digest("base64url");
  return `${body}.${signature}`;
}

/** The payload of a token made by `signPayload`, or null if forged, altered or expired. */
export function verifyPayload<T extends Record<string, unknown>>(token: string): T | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", key("sign")).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & {
      exp?: number;
    };
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
