import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { unlockFile } from "@/modules/backups/crypt";
import { makeKeyFile, openKeyFile } from "@/modules/backups/keys";

/*
 * The server's settings in every backup (G3, A9): deploy.sh pipes deploy/.env
 * into scripts/lock-settings.ts, which locks it for the owner's public key and
 * prints nothing of it; only the owner's recovery key opens it. And after a
 * restore onto a server with its own ENCRYPTION_KEY (A6), the old server's key
 * goes into ENCRYPTION_OLD_KEYS, where it opens only what it sealed.
 */

const SETTINGS = "APP_DOMAIN=erp.extasbd.com\nPOSTGRES_PASSWORD=pg-secret-1\n";
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

describe("locking the server's settings (scripts/lock-settings.ts)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "extas-settings-lock-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function lockSettings(input: string, keyFile: string) {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = execFile(
        "npx",
        ["tsx", "scripts/lock-settings.ts"],
        { env: { ...process.env, KEY_FILE: keyFile, OUT_DIR: dir }, timeout: 60_000 },
        (error, stdout, stderr) =>
          resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
      );
      child.stdin!.end(input);
    });
  }

  it("locks deploy/.env for the public key; only the recovery key opens it", async () => {
    const keys = await makeKeyFile("Padma river at dawn, 1971!");
    const keyFile = path.join(dir, "backup-public-key.json");
    await writeFile(
      keyFile,
      JSON.stringify({
        app: "Extas ERP",
        kind: "backup-public-key",
        pairId: keys.pairId,
        publicKey: keys.publicKey,
      }),
    );
    const done = await lockSettings(SETTINGS, keyFile);
    expect(done).toMatchObject({ code: 0, stdout: "" });
    expect(done.stdout + done.stderr).not.toContain("pg-secret-1");
    const locked = await readFile(path.join(dir, "settings.env.locked.new"));
    expect(locked.includes(Buffer.from("pg-secret-1"))).toBe(false);
    const facts = JSON.parse(await readFile(path.join(dir, "settings.env.json.new"), "utf8"));
    expect(facts).toMatchObject({
      pairId: keys.pairId,
      plain: { bytes: SETTINGS.length, sha256: sha256(SETTINGS) },
      locked: { bytes: locked.length, sha256: sha256(locked) },
    });

    const privateKey = await openKeyFile(keys, "Padma river at dawn, 1971!");
    const opened = path.join(dir, "settings.env");
    await unlockFile(
      { privateKeys: new Map([[keys.pairId, privateKey]]) },
      path.join(dir, "settings.env.locked.new"),
      opened,
    );
    expect(await readFile(opened, "utf8")).toBe(SETTINGS);
    await expect(openKeyFile(keys, "Padma river at dusk")).rejects.toThrow(
      "This recovery key is not the one these backups were locked with.",
    );
  });

  it("refuses a public key file that is not right, and writes nothing", async () => {
    const keyFile = path.join(dir, "backup-public-key.json");
    await writeFile(keyFile, JSON.stringify({ kind: "something-else" }));
    const done = await lockSettings(SETTINGS, keyFile);
    expect(done.code).not.toBe(0);
    expect(done.stderr).toContain("Error: the backup public key file is not right");
    expect((await readdir(dir)).sort()).toEqual(["backup-public-key.json"]);
  });
});

describe("the old server's key after a restore (ENCRYPTION_OLD_KEYS)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("opens what the old server sealed; everything new is sealed with this server's key", () => {
    vi.stubEnv("ENCRYPTION_KEY", "old-server-key-0123456789");
    vi.stubEnv("ENCRYPTION_OLD_KEYS", "");
    const sealedThere = encryptSecret("the Google refresh token");

    vi.stubEnv("ENCRYPTION_KEY", "this-servers-own-key-0123456789");
    expect(() => decryptSecret(sealedThere)).toThrow(/could not be unlocked/);
    vi.stubEnv("ENCRYPTION_OLD_KEYS", "short, old-server-key-0123456789");
    expect(decryptSecret(sealedThere)).toBe("the Google refresh token");
    const sealedHere = encryptSecret("a new secret");
    vi.stubEnv("ENCRYPTION_OLD_KEYS", "");
    expect(decryptSecret(sealedHere)).toBe("a new secret");
  });
});
