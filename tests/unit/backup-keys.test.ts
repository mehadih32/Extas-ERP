import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  backupKey,
  BackupKeyError,
  lockedForPair,
  lockFile,
  lockStream,
  lockStreamFor,
  newRecoveryKey,
  parseRecoveryKey,
  PIECE_BYTES,
  unlockFile,
  unlockStream,
} from "@/modules/backups/crypt";
import {
  keyStrength,
  makeKeyFile,
  normalizeRecoveryKey,
  openKeyFile,
  pairIdOf,
  parseKeyFile,
  publicKeyOf,
  recoveryKeyProblem,
  relockKeyFile,
  SCRYPT,
} from "@/modules/backups/keys";

/*
 * A9 and G4: backups are locked with a public key; the private key is kept only
 * locked with the owner's own recovery key (scrypt). The server never holds the
 * recovery key or the open private key.
 */

const OWNER_KEY = "Padma river at dawn, 1971!";

describe("the owner's recovery key", () => {
  it("is any word, sentence or pattern of at least 6 characters", () => {
    expect(recoveryKeyProblem("short")).toBe("Use at least 6 characters");
    expect(recoveryKeyProblem("  5 ch  ")).toBe("Use at least 6 characters");
    // Letters, digits, symbols or Bengali all count, each as one character.
    expect(recoveryKeyProblem("six ch")).toBeNull();
    expect(recoveryKeyProblem("123456")).toBeNull();
    expect(recoveryKeyProblem("#$%&*!")).toBeNull();
    expect(recoveryKeyProblem("আমার দেশ")).toBeNull();
    expect(recoveryKeyProblem("🌾🌾🌾🌾🌾")).toBe("Use at least 6 characters");
    expect(recoveryKeyProblem("আমার সোনার বাংলা")).toBeNull();
    expect(recoveryKeyProblem("x".repeat(201))).toBe("Use at most 200 characters");
    // The same letters however they were typed; spaces at the ends do not count.
    expect(normalizeRecoveryKey("  Café key  ")).toBe("Café key");
  });

  it("warns gently, without blocking, when the key is shorter than 10 characters", () => {
    for (const key of ["abc123", "Dhaka-26!", "আমার দেশ"]) {
      expect(recoveryKeyProblem(key)).toBeNull();
      expect(keyStrength(key).level).toBe("weak");
      expect(keyStrength(key).hint).toMatch(/^Short: it works, but 10 or more characters is safer/);
    }
    expect(keyStrength("abc").hint).toBe("Use at least 6 characters.");
    expect(keyStrength("Dhaka-2026!").hint).not.toMatch(/^Short/);
  });

  it("gets a plain strength hint, and a warning for letters PuTTY cannot type", () => {
    expect(keyStrength("dhakacity1").level).toBe("weak");
    expect(keyStrength("dhakacity1").hint).toMatch(/^Weak: easy to guess/);
    expect(keyStrength("Dhaka-2026!").level).toBe("fair");
    expect(keyStrength(OWNER_KEY).level).toBe("strong");
    expect(keyStrength("my four word key").level).toBe("strong");
    expect(keyStrength(OWNER_KEY).plainKeyboard).toBe(true);
    const bangla = keyStrength("আমার সোনার বাংলা আমি তোমায় ভালোবাসি");
    expect(bangla.plainKeyboard).toBe(false);
    expect(bangla.hint).toMatch(/keep it in Google Drive, or use English letters and digits/);
  });
});

describe("the key pair and its keys file", () => {
  let file: Awaited<ReturnType<typeof makeKeyFile>>;
  beforeAll(async () => {
    file = await makeKeyFile(OWNER_KEY);
  });

  it("keeps the private key only locked with strong scrypt", () => {
    expect(file).toMatchObject({ kind: "backup-keys", version: 1 });
    expect(file.pairId).toMatch(/^[0-9A-F]{8}$/);
    expect(file.pairId).toBe(pairIdOf(Buffer.from(file.publicKey, "base64url")));
    expect(file.lockedPrivateKey).toMatchObject({ kdf: "scrypt", N: 131072, r: 8, p: 1 });
    expect(SCRYPT.N).toBeGreaterThanOrEqual(1 << 17);
    const text = JSON.stringify(file);
    expect(text).not.toContain(OWNER_KEY);
    expect(text).not.toContain("Padma");
    expect(parseKeyFile(text)).toEqual(file);
  });

  it("opens with the recovery key, typed with spaces around it, and with nothing else", async () => {
    const opened = await openKeyFile(file, `  ${OWNER_KEY} `);
    expect(opened.asymmetricKeyType).toBe("x25519");
    await expect(openKeyFile(file, "Padma river at dawn, 1972!")).rejects.toThrow(
      /not the one these backups were locked with/,
    );
    await expect(openKeyFile(file, OWNER_KEY.toLowerCase())).rejects.toThrow(BackupKeyError);
  });

  it("refuses a keys file that was changed", async () => {
    const other = await makeKeyFile(OWNER_KEY);
    // Another pair's locked private key under this pair's public key.
    const mixed = { ...file, lockedPrivateKey: other.lockedPrivateKey };
    await expect(openKeyFile(mixed, OWNER_KEY)).rejects.toThrow(BackupKeyError);
    expect(() => parseKeyFile(JSON.stringify({ ...file, pairId: "00000000" }))).toThrow(/damaged/);
    expect(() => parseKeyFile("{not json")).toThrow(/damaged/);
  });

  it("changes the recovery key without changing the pair, so older backups still open", async () => {
    const locked = await lockedBytes(publicKeyOf(file), Buffer.from("payroll"));
    const changed = await relockKeyFile(file, OWNER_KEY, "a brand new sentence key");
    expect(changed.pairId).toBe(file.pairId);
    expect(changed.publicKey).toBe(file.publicKey);
    expect(changed.lockedPrivateKey.data).not.toBe(file.lockedPrivateKey.data);
    await expect(openKeyFile(changed, OWNER_KEY)).rejects.toThrow(BackupKeyError);
    const privateKey = await openKeyFile(changed, "a brand new sentence key");
    const opened = await buffer(
      Readable.from([locked]).pipe(
        unlockStream({ privateKeys: new Map([[file.pairId, privateKey]]) }),
      ),
    );
    expect(opened.toString()).toBe("payroll");
    // The old key must open it first.
    await expect(relockKeyFile(file, "not the key at all", "x".repeat(12))).rejects.toThrow(
      BackupKeyError,
    );
    await expect(relockKeyFile(file, OWNER_KEY, "short")).rejects.toThrow(/at least 6/);
  });
});

async function lockedBytes(recipient: ReturnType<typeof publicKeyOf>, plain: Buffer) {
  return buffer(Readable.from([plain]).pipe(lockStreamFor(recipient)));
}

describe("files locked with the public key", () => {
  let file: Awaited<ReturnType<typeof makeKeyFile>>;
  let privateKeys: Map<string, import("node:crypto").KeyObject>;
  beforeAll(async () => {
    file = await makeKeyFile(OWNER_KEY);
    privateKeys = new Map([[file.pairId, await openKeyFile(file, OWNER_KEY)]]);
  });
  const unlock = (locked: Buffer, opener: Parameters<typeof unlockStream>[0]) =>
    buffer(Readable.from([locked]).pipe(unlockStream(opener)));

  it("open again byte for byte with the private key, at every size around a piece", async () => {
    for (const size of [0, 1, PIECE_BYTES - 1, PIECE_BYTES, PIECE_BYTES + 1, 2 * PIECE_BYTES + 5]) {
      const plain = randomBytes(size);
      const locked = await lockedBytes(publicKeyOf(file), plain);
      expect(locked.subarray(0, 8).toString()).toBe("EXTASPK1");
      expect(lockedForPair(locked)).toBe(file.pairId);
      expect((await unlock(locked, { privateKeys })).equals(plain), `size ${size}`).toBe(true);
    }
  });

  it("are locked to fresh bytes every time, and never hold the plain bytes", async () => {
    const plain = Buffer.from("PGDMP company Extas, invoices and payroll ".repeat(50));
    const a = await lockedBytes(publicKeyOf(file), plain);
    const b = await lockedBytes(publicKeyOf(file), plain);
    expect(a.equals(b)).toBe(false);
    expect(a.includes("PGDMP")).toBe(false);
    expect(a.includes("payroll")).toBe(false);
  });

  it("do not open with another pair's key, a v6.3 key, or after a change", async () => {
    const locked = await lockedBytes(publicKeyOf(file), randomBytes(1000));
    const other = await makeKeyFile("someone else's key");
    const otherKeys = new Map([[other.pairId, await openKeyFile(other, "someone else's key")]]);
    await expect(unlock(locked, { privateKeys: otherKeys })).rejects.toThrow(
      new RegExp(`another recovery key \\(key ${file.pairId}\\)`),
    );
    // A forged pair id cannot borrow another key: the derived key is wrong.
    const forged = Buffer.from(locked);
    forged.write(other.pairId, 8, "ascii");
    await expect(unlock(forged, { privateKeys: otherKeys })).rejects.toThrow(BackupKeyError);
    const legacy = backupKey(parseRecoveryKey(newRecoveryKey()));
    await expect(unlock(locked, legacy)).rejects.toThrow(/another recovery key/);
    const changed = Buffer.from(locked);
    changed[changed.length - 20]! ^= 1;
    await expect(unlock(changed, { privateKeys })).rejects.toThrow(BackupKeyError);
    await expect(unlock(locked.subarray(0, locked.length - 5), { privateKeys })).rejects.toThrow(
      /cut short/,
    );
  });

  it("leave v6.3 backups openable with the old key typed in (format 2)", async () => {
    const typed = newRecoveryKey();
    const legacy = backupKey(parseRecoveryKey(typed));
    const plain = randomBytes(5000);
    const old = await buffer(Readable.from([plain]).pipe(lockStream(legacy)));
    expect((await unlock(old, { legacy, privateKeys })).equals(plain)).toBe(true);
    await expect(unlock(old, { privateKeys })).rejects.toThrow(/old \(v6\.3\) recovery key/);
  });

  describe("on disk", () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), "extas-pk-"));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("say the size and checksums of the plain and the locked file", async () => {
      const plain = randomBytes(PIECE_BYTES + 99);
      await writeFile(path.join(dir, "media.tar.gz"), plain);
      const facts = await lockFile(
        publicKeyOf(file),
        path.join(dir, "media.tar.gz"),
        path.join(dir, "media.tar.gz.locked"),
      );
      expect(facts.plain.bytes).toBe(plain.length);
      expect(facts.locked.bytes).toBe(
        (await readFile(path.join(dir, "media.tar.gz.locked"))).length,
      );
      const opened = await unlockFile(
        { privateKeys },
        path.join(dir, "media.tar.gz.locked"),
        path.join(dir, "back.tar.gz"),
      );
      expect(opened.sha256).toBe(facts.plain.sha256);
    });
  });
});
