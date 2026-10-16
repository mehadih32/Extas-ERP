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
  keyId,
  lockFile,
  lockStream,
  newRecoveryKey,
  parseRecoveryKey,
  PIECE_BYTES,
  unlockFile,
  unlockStream,
} from "@/modules/backups/crypt";

const lock = (key: Buffer, plain: Buffer) => buffer(Readable.from([plain]).pipe(lockStream(key)));
const unlock = (key: Buffer, locked: Buffer) =>
  buffer(Readable.from([locked]).pipe(unlockStream(key)));

describe("recovery key", () => {
  it("is 14 groups of 4 letters and digits that read back to the same key", () => {
    const typed = newRecoveryKey();
    expect(typed).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
    const bytes = parseRecoveryKey(typed);
    expect(bytes).toHaveLength(32);
    // Small letters, spaces instead of dashes, and O/I/L for 0/1 all read the same.
    const loose = typed.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
    expect(parseRecoveryKey(loose).equals(bytes)).toBe(true);
    expect(newRecoveryKey()).not.toBe(typed);
  });

  it("refuses a key with a typo or the wrong length before any backup is tried", () => {
    const typed = newRecoveryKey();
    const swap = typed[0] === "A" ? "B" : "A";
    expect(() => parseRecoveryKey(swap + typed.slice(1))).toThrow(/typo/);
    expect(() => parseRecoveryKey(typed.slice(0, -5))).toThrow(/14 groups of 4/);
    expect(() => parseRecoveryKey(`${typed}-AAAA`)).toThrow(BackupKeyError);
  });

  it("names a backup key without revealing it", () => {
    const key = backupKey(parseRecoveryKey(newRecoveryKey()));
    expect(keyId(key)).toMatch(/^[0-9A-F]{8}$/);
    expect(keyId(key)).toBe(keyId(Buffer.from(key)));
    expect(key.toString("hex")).not.toContain(keyId(key).toLowerCase());
  });
});

describe("locked backup files", () => {
  const key = backupKey(parseRecoveryKey(newRecoveryKey()));

  it("open again byte for byte, at every size around a piece", async () => {
    for (const size of [0, 1, PIECE_BYTES - 1, PIECE_BYTES, PIECE_BYTES + 1, 3 * PIECE_BYTES + 5]) {
      const plain = randomBytes(size);
      const locked = await lock(key, plain);
      expect(locked.subarray(0, 8).toString()).toBe("EXTASBK1");
      expect(locked.includes(plain.subarray(0, Math.min(size, 64))) && size >= 16).toBe(false);
      expect((await unlock(key, locked)).equals(plain), `size ${size}`).toBe(true);
    }
  });

  it("never lock the same file to the same bytes twice", async () => {
    const plain = Buffer.from("the same backup");
    expect((await lock(key, plain)).equals(await lock(key, plain))).toBe(false);
  });

  it("do not open with another recovery key", async () => {
    const locked = await lock(key, Buffer.from("payroll and prices"));
    const other = backupKey(parseRecoveryKey(newRecoveryKey()));
    await expect(unlock(other, locked)).rejects.toThrow(/does not open this backup/);
  });

  it("do not open when a byte was changed, a piece is missing or the end was cut off", async () => {
    const plain = randomBytes(2 * PIECE_BYTES + 100);
    const locked = await lock(key, plain);

    const changed = Buffer.from(locked);
    changed.writeUInt8(changed.readUInt8(PIECE_BYTES + 500) ^ 1, PIECE_BYTES + 500);
    await expect(unlock(key, changed)).rejects.toThrow(BackupKeyError);

    // Cut after the first two whole pieces: they open, but the last one is missing.
    const piece = 4 + PIECE_BYTES + 16;
    await expect(unlock(key, locked.subarray(0, 24 + 2 * piece))).rejects.toThrow(/cut short/);
    await expect(unlock(key, locked.subarray(0, locked.length - 3))).rejects.toThrow(/cut short/);

    // The second piece taken out: the third one does not open in its place.
    const skipped = Buffer.concat([
      locked.subarray(0, 24 + piece),
      locked.subarray(24 + 2 * piece),
    ]);
    await expect(unlock(key, skipped)).rejects.toThrow(/damaged/);

    await expect(unlock(key, Buffer.from("PGDMP not locked at all"))).rejects.toThrow(
      /not a locked Extas ERP backup/,
    );
  });

  describe("on disk", () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), "extas-backup-lock-"));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("say the size and checksums of the plain and the locked file", async () => {
      const plain = randomBytes(PIECE_BYTES + 7);
      await writeFile(path.join(dir, "database.dump"), plain);
      const facts = await lockFile(
        key,
        path.join(dir, "database.dump"),
        path.join(dir, "database.dump.locked"),
      );
      expect(facts.plain.bytes).toBe(plain.length);
      const locked = await readFile(path.join(dir, "database.dump.locked"));
      expect(facts.locked.bytes).toBe(locked.length);
      expect(facts.locked.md5).toMatch(/^[0-9a-f]{32}$/);

      const opened = await unlockFile(
        key,
        path.join(dir, "database.dump.locked"),
        path.join(dir, "back.dump"),
      );
      expect(opened.sha256).toBe(facts.plain.sha256);
      expect((await readFile(path.join(dir, "back.dump"))).equals(plain)).toBe(true);
    });
  });
});
