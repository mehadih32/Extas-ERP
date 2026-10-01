import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt (no native dependency).
 * Stored format: scrypt$N$r$p$<salt base64>$<hash base64>
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, opts: ScryptOptions, keyLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      keyLength,
      { ...opts, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { N, r: R, p: P }, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, "base64");
  const actual = await derive(
    password,
    Buffer.from(saltB64, "base64"),
    { N: Number(n), r: Number(r), p: Number(p) },
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Used when a login targets an unknown email, so response time does not reveal it. */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("timing-equaliser");
  await verifyPassword(password, await dummyHash);
}

/** Readable temporary password for invited users, e.g. "Kx7m-Qp2r-Vt9w". */
export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((c) => c.join(""))
    .join("-");
}
