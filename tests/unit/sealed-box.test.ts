import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { blake2b, sealedBox, sealedBoxOpen } from "@/lib/sealed-box";

/*
 * The sealed box GitHub wants a repository secret in (v6.4.1, A13: the
 * late-backup alert's secrets). The expected bytes were made by libsodium
 * itself (crypto_box_easy with the same ephemeral key, and opened again with
 * crypto_box_seal_open), so these pieces match it exactly.
 */

const hex = (h: string) => new Uint8Array(Buffer.from(h, "hex"));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

const RECIPIENT = hex("07a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c");
const EPHEMERAL = hex("030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc");
const RECIPIENT_SECRET = hex("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
const EPHEMERAL_PUBLIC = "bb50ff9e82a574cfbf820e97f60fb9c143ec7415cf514f8cfd98eff59e059614";

describe("BLAKE2b (libsodium crypto_generichash)", () => {
  it("gives libsodium's 24-byte hashes", () => {
    const abc = new TextEncoder().encode("abc");
    expect(toHex(blake2b(abc, 24))).toBe("56a17e38cc371a46b12c32f18e0c61de2a84e9c2555b114e");
    expect(toHex(blake2b(new Uint8Array(0), 24))).toBe(
      "ab3b5331a7135ed50d0f182d026e60abdb3646fd51bcf8a3",
    );
    // More than one block (200 bytes).
    const many = new Uint8Array(Array.from({ length: 200 }, (_, i) => i));
    expect(toHex(blake2b(many, 24))).toBe("e9183c766451ac26ddd03b280b4b6000802b4b7230c78bb3");
  });
});

describe("sealed box (libsodium crypto_box_seal)", () => {
  it("seals exactly as libsodium does", () => {
    expect(toHex(sealedBox(new Uint8Array(0), RECIPIENT, EPHEMERAL))).toBe(
      `${EPHEMERAL_PUBLIC}f7a9d14631a93c1f7bf3fa2d7165d968`,
    );
    const token = new TextEncoder().encode("ghp_example-token-value");
    expect(toHex(sealedBox(token, RECIPIENT, EPHEMERAL))).toBe(
      `${EPHEMERAL_PUBLIC}8aeca66b47770512416ba1a735c9c814301b7c2514ec96fb5252c919fcb5e0c50f4ca2a0055fae`,
    );
    // A long value: several stream blocks and Poly1305 blocks.
    const long = new Uint8Array([
      ...Array.from({ length: 512 }, (_, i) => i % 256),
      "x".charCodeAt(0),
    ]);
    const sealed = sealedBox(long, RECIPIENT, EPHEMERAL);
    expect(sealed.length).toBe(32 + 16 + long.length);
    expect(createHash("sha256").update(sealed).digest("hex")).toBe(
      "a7b1889d52ce3441d08104a75ce6aa5484a1a605929c027f3b0c5877ea3cd1f5",
    );
  });

  it("uses a new ephemeral key each time, and refuses a key of the wrong size", () => {
    const message = new TextEncoder().encode("same");
    const a = sealedBox(message, RECIPIENT);
    const b = sealedBox(message, RECIPIENT);
    expect(a.length).toBe(32 + 16 + 4);
    expect(toHex(a.subarray(0, 32))).not.toBe(toHex(b.subarray(0, 32)));
    expect(() => sealedBox(message, RECIPIENT.subarray(0, 31))).toThrow(/32 bytes/);
  });

  it("opens what libsodium sealed, and nothing changed or sealed to another key", () => {
    const made = hex(
      `${EPHEMERAL_PUBLIC}8aeca66b47770512416ba1a735c9c814301b7c2514ec96fb5252c919fcb5e0c50f4ca2a0055fae`,
    );
    const opened = sealedBoxOpen(made, RECIPIENT, RECIPIENT_SECRET);
    expect(new TextDecoder().decode(opened!)).toBe("ghp_example-token-value");
    const changed = made.slice();
    changed[60] = changed[60]! ^ 1;
    expect(sealedBoxOpen(changed, RECIPIENT, RECIPIENT_SECRET)).toBeNull();
    // Round trip with a new ephemeral key each time.
    const value = new TextEncoder().encode("1//refresh-token");
    const sealed = sealedBox(value, RECIPIENT);
    expect(new TextDecoder().decode(sealedBoxOpen(sealed, RECIPIENT, RECIPIENT_SECRET)!)).toBe(
      "1//refresh-token",
    );
    expect(sealedBoxOpen(sealed, RECIPIENT, EPHEMERAL)).toBeNull();
  });
});
