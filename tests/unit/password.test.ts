import { describe, expect, it } from "vitest";

import { generateTemporaryPassword, hashPassword, verifyPassword } from "@/lib/auth/password";
import { hashSessionToken, generateSessionToken } from "@/lib/auth/token";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("Extras2026!");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("Extras2026!", hash)).toBe(true);
    expect(await verifyPassword("extras2026!", hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toEqual(await hashPassword("same"));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });

  it("generates readable temporary passwords", () => {
    expect(generateTemporaryPassword()).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  });
});

describe("session tokens", () => {
  it("are random and stored only as a hash", () => {
    const token = generateSessionToken();
    expect(token).not.toEqual(generateSessionToken());
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
  });
});
