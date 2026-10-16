import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import { backupLock, driveToken, hostRoot } from "@/modules/backups/backup-core";
import * as backups from "@/modules/backups/backup.service";
import * as cloudflare from "@/modules/backups/cloudflare";
import { countTables } from "@/modules/backups/contents";
import {
  backupKey,
  keyId,
  lockFile,
  newRecoveryKey,
  parseRecoveryKey,
  type PublicKey,
} from "@/modules/backups/crypt";
import { fetchBackup, listDriveBackups } from "@/modules/backups/drive-copies";
import { readyForRestore } from "@/modules/backups/drive-fetch";
import { parseKeyFile } from "@/modules/backups/keys";
import * as keys from "@/modules/backups/recovery-key.service";
import { requestRestore } from "@/modules/backups/restore.service";
import { backupTick, testRestoreTick } from "@/modules/backups/scheduler";
import { backupHealth, watchBackups } from "@/modules/backups/status";
import { runTestRestore, TEST_DB_PREFIX } from "@/modules/backups/test-restore";

import { type FakeCloudflare, startFakeCloudflare } from "../../scripts/fake-cloudflare";
import { type FakeGoogle, startFakeGoogle } from "../../scripts/fake-google";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

/*
 * v6.4 backups (G1-G5, G9-G11, A9): complete backups with a manifest of every
 * table and file, locked with the owner's public key; the owner's own recovery
 * key (PIN), kept in Google Drive or not; the keeping rules; Cloudflare; the
 * owner's alerts; and the monthly drill.
 */

const exec = promisify(execFile);
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const OWNER_KEY = "Padma river at dawn, 1971!";
const PIN = "2468";
const COMMIT = "c0ffee".padEnd(40, "0");
const BOOTSTRAP_SHA = "ab".repeat(32);
const CF_TOKEN = "cf_token_only_dns_for_extas_0123456789abcd";

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

type Manifest = {
  format: number;
  keyId: string | null;
  commit: string | null;
  version: string | null;
  records: number;
  tables: Record<string, number>;
  uploads: Array<{ path: string; bytes: number; sha256: string }>;
  missing: string[];
  files: Array<{ name: string; bytes: number; sha256: string; plain?: { name: string } }>;
};

// Real backups, restores and PDFs: slow on a busy machine, so 2 minutes each.
run("v6.4 backups", { timeout: 120_000 }, () => {
  let dir: string;
  let backupDir: string;
  let uploadDir: string;
  let owner: { userId: string };
  let ctx: CompanyContext;
  let google: FakeGoogle;

  beforeEach(async () => {
    await resetDb();
    dir = await mkdtemp(path.join(os.tmpdir(), "extas-v64-"));
    backupDir = path.join(dir, "backups");
    uploadDir = path.join(dir, "uploads");
    vi.stubEnv("BACKUP_DIR", backupDir);
    vi.stubEnv("UPLOAD_DIR", uploadDir);
    vi.stubEnv("PG_DUMP_PATH", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "client-123.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret-abcdef");
    vi.stubEnv("APP_URL", "https://erp.extasbd.com");
    google = await startFakeGoogle({ email: "owner@gmail.com" }, 0);
    vi.stubEnv("GOOGLE_OAUTH_BASE", google.url);
    vi.stubEnv("GOOGLE_DRIVE_BASE", google.url);
    await mkdir(path.join(uploadDir, "c1", "2026", "10"), { recursive: true });
    await writeFile(path.join(uploadDir, "c1", "2026", "10", "logo.png"), "not really a png");
    await writeFile(path.join(uploadDir, "c1", "2026", "10", "bill scan.pdf"), randomBytes(3000));
    owner = { userId: (await makeUser("owner@extas.test", { isSuperAdmin: true })).id };
    const { company, roles } = await makeCompany("Extas");
    await addToCompany(owner.userId, company.id, roles.SUPER_ADMIN);
    ctx = await contextFor(owner.userId, company.id);
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await google.close();
    await rm(dir, { recursive: true, force: true });
  });

  const backUpNow = () => backups.runBackup({ trigger: "MANUAL", actor: owner, wait: true });
  const folderOf = async (runId: string) => {
    const saved = await prisma.backupRun.findUniqueOrThrow({ where: { id: runId } });
    return path.join(backupDir, path.dirname(saved.dbDumpPath!));
  };
  const manifestOf = async (runId: string) =>
    JSON.parse(
      await readFile(path.join(await folderOf(runId), "manifest.json"), "utf8"),
    ) as Manifest;
  const inbox = async () =>
    (
      await prisma.notificationLog.findMany({
        where: { userId: owner.userId },
        orderBy: { createdAt: "asc" },
      })
    ).map((n) => n.subject);
  const rootFiles = () => {
    const root = [...google.files.values()].find((f) => f.appProperties.extas === "backups");
    return [...google.files.values()].filter((f) => root && f.parents.includes(root.id));
  };
  const labelled = (label: string) => rootFiles().filter((f) => f.appProperties.extas === label);

  async function connectDrive() {
    await backups.startGoogleSignIn(owner);
    expect((await backups.checkGoogleSignIn(owner)).status).toBe("connected");
  }
  async function setKey(extra: Record<string, unknown> = {}) {
    await setPin(ctx, { pin: PIN });
    return keys.setRecoveryKey(ctx, { pin: PIN, key: OWNER_KEY, confirm: OWNER_KEY, ...extra });
  }
  /** What deploy.sh leaves in BACKUP_DIR/.host at an update. */
  async function prepareHost(
    lock: PublicKey | null,
    env = "APP_DOMAIN=erp.extasbd.com\nPOSTGRES_PASSWORD=pg-secret-1\n",
  ) {
    const host = hostRoot();
    await mkdir(host, { recursive: true });
    await writeFile(
      path.join(host, "version.json"),
      JSON.stringify({
        commit: COMMIT,
        bootstrapSha256: BOOTSTRAP_SHA,
        deployedAt: new Date().toISOString(),
        version: "6.4.0",
      }),
    );
    await writeFile(path.join(host, "code.bundle"), "# v2 git bundle\nthe code at the commit\n");
    if (lock) {
      const plain = path.join(dir, "settings.env");
      await writeFile(plain, env);
      const facts = await lockFile(lock, plain, path.join(host, "settings.env.locked"));
      await rm(plain);
      await writeFile(
        path.join(host, "settings.env.json"),
        JSON.stringify({
          pairId: lock.pairId,
          plain: { bytes: facts.plain.bytes, sha256: facts.plain.sha256 },
          locked: { bytes: facts.locked.bytes, sha256: facts.locked.sha256 },
        }),
      );
    }
  }
  /** Restores a dump into a throwaway database and counts every table there. */
  async function restoredCounts(dump: string) {
    const name = `extas_g_v64_${randomBytes(4).toString("hex")}`;
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    try {
      const env = {
        ...process.env,
        ...backups.pgEnvironment(process.env.DATABASE_URL!),
        PGDATABASE: name,
      };
      await exec(
        "pg_restore",
        ["--no-owner", "--no-privileges", "--exit-on-error", "-d", name, dump],
        { env },
      );
      const { stdout } = await exec(
        "psql",
        [
          "-tAc",
          `SELECT table_name || '|' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
        ],
        { env },
      );
      return Object.fromEntries(
        stdout
          .trim()
          .split("\n")
          .map((l) => [l.split("|")[0]!, Number(l.split("|")[1])]),
      );
    } finally {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
    }
  }

  describe("a complete backup (G3)", () => {
    it("lists every table's row count and every file's checksum, taken with the dump", async () => {
      await prepareHost(null);
      const done = await backUpNow();
      expect(done.status).toBe("SUCCEEDED");
      const folder = await folderOf(done.id);
      expect((await readdir(folder)).sort()).toEqual([
        "code.bundle",
        "database.dump",
        "manifest.json",
        "media.tar.gz",
      ]);
      const manifest = await manifestOf(done.id);
      // Every table in the database, with the number of rows the dump holds.
      const live = await countTables();
      expect(Object.keys(manifest.tables).sort()).toEqual(Object.keys(live).sort());
      expect(Object.keys(manifest.tables).length).toBeGreaterThan(50);
      expect(manifest.tables.Company).toBe(1);
      expect(manifest.tables.User).toBe(1);
      expect(manifest.records).toBe(Object.values(manifest.tables).reduce((a, b) => a + b, 0));
      expect(await restoredCounts(path.join(folder, "database.dump"))).toEqual(manifest.tables);
      // Every uploaded file, with its size and checksum, in the archive.
      expect(manifest.uploads).toEqual([
        {
          path: "c1/2026/10/bill scan.pdf",
          bytes: 3000,
          sha256: sha256(await readFile(path.join(uploadDir, "c1/2026/10/bill scan.pdf"))),
        },
        { path: "c1/2026/10/logo.png", bytes: 16, sha256: sha256("not really a png") },
      ]);
      const { stdout } = await exec("tar", ["-tzf", path.join(folder, "media.tar.gz")]);
      expect(stdout.trim().split("\n").sort()).toEqual([
        "./c1/2026/10/bill scan.pdf",
        "./c1/2026/10/logo.png",
      ]);
      // The code at the running version, and what is missing, in plain words.
      expect(manifest).toMatchObject({ format: 1, commit: COMMIT, version: "6.4.0" });
      expect(manifest.missing).toEqual([
        expect.stringMatching(
          /^The server's settings file \(deploy\/\.env\): it is put in backups once you set your own recovery key/,
        ),
      ]);
      expect(done.report).toMatchObject({
        format: 1,
        files: 2,
        commit: COMMIT,
        records: manifest.records,
        tables: Object.keys(manifest.tables).length,
      });
    });

    it("says plainly when the server has not made the code bundle yet, and backs up empty uploads", async () => {
      await rm(uploadDir, { recursive: true, force: true });
      const done = await backUpNow();
      const manifest = await manifestOf(done.id);
      expect(manifest.uploads).toEqual([]);
      expect(manifest.missing[0]).toMatch(/^The code at the running version/);
      const { stdout } = await exec("tar", [
        "-tzf",
        path.join(await folderOf(done.id), "media.tar.gz"),
      ]);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("the owner's recovery key (A9, G4, G5)", () => {
    it("needs the PIN and the key typed twice, and is never made up or stored", async () => {
      await expectAppError(
        keys.setRecoveryKey(ctx, { key: OWNER_KEY, confirm: OWNER_KEY }),
        "VALIDATION",
      );
      await setPin(ctx, { pin: PIN });
      await expectAppError(
        keys.setRecoveryKey(ctx, { key: OWNER_KEY, confirm: OWNER_KEY }),
        "VALIDATION",
      );
      await expectAppError(
        keys.setRecoveryKey(ctx, { pin: "1111", key: OWNER_KEY, confirm: OWNER_KEY }),
        "VALIDATION",
      );
      const short = await expectAppError(
        keys.setRecoveryKey(ctx, { pin: PIN, key: "short", confirm: "short" }),
        "VALIDATION",
      );
      expect(short.details).toEqual({ key: ["Use at least 6 characters"] });
      const differ = await expectAppError(
        keys.setRecoveryKey(ctx, { pin: PIN, key: OWNER_KEY, confirm: `${OWNER_KEY}x` }),
        "VALIDATION",
      );
      expect(differ.details).toHaveProperty("confirm");

      const set = await keys.setRecoveryKey(ctx, { pin: PIN, key: OWNER_KEY, confirm: OWNER_KEY });
      expect(set.config.recoveryKey).toMatchObject({
        set: true,
        keepInDrive: true,
        inDriveAt: null,
      });
      expect(set.config.recoveryKey.pairId).toMatch(/^[0-9A-F]{8}$/);
      // Drive is not connected yet: the screen asks to put it there later.
      expect(set.driveProblem).toMatch(/Google Drive is not connected/);

      // Nowhere on the server: not the settings row, not the audit log, not a file.
      const config = await backups.getBackupConfig();
      expect(JSON.stringify(config)).not.toContain(OWNER_KEY);
      expect(JSON.stringify(config)).not.toContain("Padma");
      const audits = await prisma.auditLog.findMany({ where: { entityType: "BackupConfig" } });
      expect(audits.map((a) => a.summary)).toEqual([
        `Set the backup recovery key (key ${set.config.recoveryKey.pairId}); not in Google Drive yet`,
      ]);
      expect(JSON.stringify(audits)).not.toContain("Padma");
      // The server keeps the public key and the locked keys file only.
      const file = parseKeyFile(config.lockedKeyFile!);
      expect(file.publicKey).toBe(config.publicKey);
      const hostKey = JSON.parse(
        await readFile(path.join(backupDir, "backup-public-key.json"), "utf8"),
      ) as Record<string, string>;
      expect(hostKey).toEqual({
        app: "Extas ERP",
        kind: "backup-public-key",
        pairId: config.keyPairId,
        publicKey: config.publicKey,
      });
      const done = await backUpNow();
      const everything = await exec("grep", ["-rla", "Padma", backupDir]).then(
        (r) => r.stdout,
        () => "",
      );
      expect(everything).toBe("");
      expect(done.keyId).toBe(config.keyPairId);
    });

    it("locks every part with the public key; the recovery key alone opens it", async () => {
      await connectDrive();
      const set = await setKey();
      const pairId = set.config.recoveryKey.pairId!;
      const config = await backups.getBackupConfig();
      await prepareHost(backupLock(config)!.key as PublicKey);
      await prisma.backupConfig.update({
        where: { id: config.id },
        data: {
          cloudflareZone: "extasbd.com",
          cloudflareZoneId: "zone-1",
          cloudflareTokenRef: encryptSecret(CF_TOKEN),
          cloudflareTokenHint: CF_TOKEN.slice(-4),
        },
      });
      const done = await backUpNow();
      expect(done).toMatchObject({ status: "SUCCEEDED", keyId: pairId, onGoogleDrive: true });
      expect(done.checkedAt).not.toBeNull();
      // G2: the server keeps its copy too.
      expect(done.filesDeletedAt).toBeNull();
      const folder = await folderOf(done.id);
      expect((await readdir(folder)).sort()).toEqual([
        "backup-keys.json",
        "code.bundle.locked",
        "database.dump.locked",
        "manifest.json",
        "media.tar.gz.locked",
        "server.json.locked",
        "settings.env.locked",
      ]);
      const manifest = await manifestOf(done.id);
      expect(manifest).toMatchObject({ format: 3, keyId: pairId, missing: [] });
      for (const name of await readdir(folder)) {
        const data = await readFile(path.join(folder, name));
        if (name.endsWith(".locked")) expect(data.subarray(0, 8).toString()).toBe("EXTASPK1");
        expect(data.includes(CF_TOKEN)).toBe(false);
        expect(data.includes("pg-secret-1")).toBe(false);
        expect(data.includes("test-encryption-key-0123456789")).toBe(false);
        expect(data.includes(OWNER_KEY)).toBe(false);
      }

      // In Drive: the same files, the keys file beside the backups, and the key itself (kept on).
      const token = (await driveToken(config))!;
      const [drv] = (await listDriveBackups()).items;
      expect(drv).toMatchObject({ name: done.name, checked: true, keyId: pairId, format: 3 });
      expect(labelled("keys")).toHaveLength(1);
      expect(JSON.parse(labelled("keys")[0]!.data!.toString())).toMatchObject({ pairId });
      const kept = JSON.parse(labelled("restore-key")[0]!.data!.toString()) as Record<
        string,
        string
      >;
      expect(kept).toMatchObject({ kind: "restore-key", pairId, recoveryKey: OWNER_KEY });

      // Opened on a new server with the recovery key only: every part, checked.
      const opened = await fetchBackup(
        token,
        { id: drv!.folderId, name: drv!.name },
        path.join(dir, "new-server"),
        { recoveryKey: `  ${OWNER_KEY} ` },
      );
      expect((await readFile(opened.database)).subarray(0, 5).toString()).toBe("PGDMP");
      expect(await readFile(opened.settings!, "utf8")).toContain("POSTGRES_PASSWORD=pg-secret-1");
      expect(await readFile(opened.code!, "utf8")).toContain("the code at the commit");
      expect(opened.server).toMatchObject({
        encryptionKey: "test-encryption-key-0123456789",
        appDomain: "erp.extasbd.com",
        ownerEmail: "owner@extas.test",
        google: {
          clientId: "client-123.apps.googleusercontent.com",
          clientSecret: "client-secret-abcdef",
        },
        cloudflare: { zone: "extasbd.com", zoneId: "zone-1", token: CF_TOKEN },
      });
      await expect(
        fetchBackup(token, { id: drv!.folderId, name: drv!.name }, path.join(dir, "x"), {
          recoveryKey: "not the owner's key at all",
        }),
      ).rejects.toThrow(/not the one these backups were locked with/);
      await expect(
        fetchBackup(token, { id: drv!.folderId, name: drv!.name }, path.join(dir, "y"), {}),
      ).rejects.toThrow(/needs your recovery key/);

      // For restore.sh: only the database and the files, and the counts to compare.
      await readyForRestore(opened);
      expect((await readdir(opened.dir)).sort()).toEqual([
        "database.dump",
        "manifest.json",
        "media.tar.gz",
      ]);
      const forRestore = JSON.parse(
        await readFile(path.join(opened.dir, "manifest.json"), "utf8"),
      ) as Manifest;
      expect(forRestore.tables).toEqual(manifest.tables);
    });

    it("puts the settings file in only when the server locked it with this key", async () => {
      await setKey();
      const other = parseKeyFile(
        JSON.stringify(
          await (await import("@/modules/backups/keys")).makeKeyFile("another key entirely"),
        ),
      );
      await prepareHost({ pairId: other.pairId, key: Buffer.from(other.publicKey, "base64url") });
      const done = await backUpNow();
      const manifest = await manifestOf(done.id);
      expect(manifest.files.map((f) => f.name)).not.toContain("settings.env.locked");
      expect(manifest.missing).toEqual([
        expect.stringMatching(
          /^The server's settings file \(deploy\/\.env\): the server locks it with your backup key/,
        ),
      ]);
    });

    it("changes with the PIN and the current key, and every backup still opens", async () => {
      await connectDrive();
      const first = await setKey();
      const old = await backUpNow();
      const wrong = await expectAppError(
        keys.setRecoveryKey(ctx, {
          pin: PIN,
          key: "a brand new sentence key",
          confirm: "a brand new sentence key",
          currentKey: "not my key",
        }),
        "VALIDATION",
      );
      expect(wrong.details).toEqual({ currentKey: ["That is not your current recovery key"] });
      const changed = await keys.setRecoveryKey(ctx, {
        pin: PIN,
        key: "a brand new sentence key",
        confirm: "a brand new sentence key",
        currentKey: OWNER_KEY,
      });
      expect(changed.config.recoveryKey.pairId).toBe(first.config.recoveryKey.pairId);
      expect(changed.message).toBe("Your new recovery key opens every backup, old and new.");
      // The old backup carries the old keys file; the server's (and Drive's) new one opens it too.
      const config = await backups.getBackupConfig();
      const [drv] = (await listDriveBackups()).items;
      expect(drv!.name).toBe(old.name);
      const opened = await fetchBackup(
        (await driveToken(config))!,
        { id: drv!.folderId, name: drv!.name },
        path.join(dir, "o"),
        {
          recoveryKey: "a brand new sentence key",
          keyFiles: [parseKeyFile(config.lockedKeyFile!)],
        },
      );
      expect(opened.database).toBeTruthy();
      expect(JSON.parse(labelled("restore-key")[0]!.data!.toString())).toMatchObject({
        recoveryKey: "a brand new sentence key",
      });
      expect(labelled("restore-key")).toHaveLength(1);
      expect(labelled("keys")).toHaveLength(1);
    });

    it("makes a new pair when the key is forgotten, and says which backups need the old one", async () => {
      const first = await setKey();
      const forgot = await keys.setRecoveryKey(ctx, {
        pin: PIN,
        key: "my second key, written down",
        confirm: "my second key, written down",
        forgotCurrent: true,
      });
      const oldPair = first.config.recoveryKey.pairId!;
      expect(forgot.config.recoveryKey.pairId).not.toBe(oldPair);
      expect(forgot.config.recoveryKey.earlier).toEqual([
        expect.objectContaining({ pairId: oldPair, until: expect.any(String) }),
      ]);
      expect(forgot.message).toMatch(
        new RegExp(
          `Backups made before now \\(key ${oldPair}\\) open only with your old recovery key`,
        ),
      );
    });

    it("retires v6.3's generated key, whose backups still open with the old key card", async () => {
      await connectDrive();
      // A v6.3 server: the generated key sealed in the settings, and a backup locked with it.
      const card = newRecoveryKey();
      const legacy = backupKey(parseRecoveryKey(card));
      const config = await backups.getBackupConfig();
      await prisma.backupConfig.update({
        where: { id: config.id },
        data: {
          recoveryKeyRef: encryptSecret(card),
          recoveryKeyId: keyId(legacy),
          recoveryKeyMadeAt: new Date(),
        },
      });
      expect((await backups.getBackupOverview()).config.recoveryKey.legacyInUse).toEqual({
        id: keyId(legacy),
      });
      const v63 = await backUpNow();
      expect(v63.keyId).toBe(keyId(legacy));
      expect((await manifestOf(v63.id)).format).toBe(2);

      const set = await setKey();
      expect(set.message).toBe(
        `New backups are locked with your key. Backups made before now open only with the old key card (key ${keyId(legacy)}).`,
      );
      const after = await backups.getBackupConfig();
      expect(after.recoveryKeyRef).toBeNull();
      expect(set.config.recoveryKey).toMatchObject({
        legacyInUse: null,
        legacy: { id: keyId(legacy) },
      });
      const v64 = await backUpNow();
      expect((await manifestOf(v64.id)).format).toBe(3);

      const items = (await listDriveBackups()).items;
      const oldOne = items.find((b) => b.name === v63.name)!;
      expect(oldOne.format).toBe(2);
      const token = (await driveToken(after))!;
      await expect(
        fetchBackup(token, { id: oldOne.folderId, name: oldOne.name }, path.join(dir, "a"), {
          recoveryKey: OWNER_KEY,
        }),
      ).rejects.toThrow(/old \(v6\.3\) recovery key/);
      const opened = await fetchBackup(
        token,
        { id: oldOne.folderId, name: oldOne.name },
        path.join(dir, "b"),
        { recoveryKey: card.toLowerCase() },
      );
      expect((await readFile(opened.database)).subarray(0, 5).toString()).toBe("PGDMP");
    });

    it("keeps the key in Google Drive, or takes it out (only the ERP's own copies)", async () => {
      await setKey({ keepInDrive: true });
      await connectDrive();
      expect((await backups.getBackupConfig()).keyInDriveAt).toBeNull();
      await expectAppError(keys.setKeepKeyInDrive(ctx, { pin: PIN, keep: true }), "VALIDATION");
      const wrong = await expectAppError(
        keys.setKeepKeyInDrive(ctx, { pin: PIN, keep: true, key: "not my key at all" }),
        "VALIDATION",
      );
      expect(wrong.details).toEqual({ key: ["That is not your recovery key"] });
      const on = await keys.setKeepKeyInDrive(ctx, { pin: PIN, keep: true, key: OWNER_KEY });
      expect(on.config.recoveryKey.inDriveAt).not.toBeNull();
      expect(labelled("restore-key")).toHaveLength(1);

      // A file of the owner's own with the same name is never touched.
      const root = [...google.files.values()].find((f) => f.appProperties.extas === "backups")!;
      google.files.set("owners-own", {
        id: "owners-own",
        name: "restore-key.json",
        mimeType: "application/json",
        parents: [root.id],
        appProperties: {},
        createdTime: new Date().toISOString(),
        trashed: false,
        data: Buffer.from("mine"),
      });
      await expectAppError(keys.setKeepKeyInDrive(ctx, { keep: false }), "VALIDATION");
      const off = await keys.setKeepKeyInDrive(ctx, { pin: PIN, keep: false });
      expect(off.config.recoveryKey).toMatchObject({ keepInDrive: false, inDriveAt: null });
      expect(labelled("restore-key")).toEqual([]);
      expect(google.files.has("owners-own")).toBe(true);
      expect(
        (
          await prisma.auditLog.findMany({
            where: { entityType: "BackupConfig" },
            orderBy: { createdAt: "asc" },
          })
        )
          .map((a) => a.summary)
          .slice(-2),
      ).toEqual([
        "Put the backup recovery key in Google Drive (restore-key.json and the restore guide)",
        "Took the backup recovery key out of Google Drive (restore-key.json deleted, the guide made without it)",
      ]);
    });
  });

  describe("keeping (G2)", () => {
    it("keeps the newest backups on the server, 3 to 7 of them", async () => {
      await expect(backups.updateBackupConfig(owner, { serverKeep: 2 })).rejects.toThrow(
        /at least 3/,
      );
      await expect(backups.updateBackupConfig(owner, { serverKeep: 8 })).rejects.toThrow(
        /at most 7/,
      );
      await backups.updateBackupConfig(owner, { serverKeep: 3 });
      const made = [];
      for (let i = 0; i < 5; i++) made.push(await backUpNow());
      const folders = (await readdir(backupDir)).filter(
        (n) => !n.startsWith(".") && !n.endsWith(".json"),
      );
      expect(folders.sort()).toEqual(
        made
          .slice(2)
          .map((r) => r.name)
          .sort(),
      );
      expect((await backups.getBackupRun(made[0]!.id)).filesDeletedAt).not.toBeNull();
      expect((await backups.getBackupRun(made[4]!.id)).files.database).toBe(true);
    });

    it("keeps backups in Drive for the days chosen, never the newest, or for ever", async () => {
      await connectDrive();
      await setKey();
      await backups.updateBackupConfig(owner, { driveKeepDays: 30 });
      const a = await backUpNow();
      const b = await backUpNow();
      // a is 40 days old in Drive.
      for (const f of google.files.values()) {
        if (f.name === a.name)
          f.appProperties.createdAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
      }
      await backups.updateBackupConfig(owner, { driveKeepDays: null });
      await backUpNow();
      expect((await listDriveBackups()).items.map((x) => x.name)).toContain(a.name);
      await backups.updateBackupConfig(owner, { driveKeepDays: 30 });
      const c = await backUpNow();
      const names = (await listDriveBackups()).items.map((x) => x.name);
      expect(names).not.toContain(a.name);
      expect(names).toEqual(expect.arrayContaining([b.name, c.name]));
      // Even when every backup is old, the newest stays.
      for (const f of google.files.values()) {
        if (f.appProperties.extas === "backup")
          f.appProperties.createdAt = new Date(Date.now() - 400 * 86_400_000).toISOString();
      }
      const { pruneBackups } = await import("@/modules/backups/drive-copies");
      await pruneBackups(await backups.getBackupConfig());
      expect((await listDriveBackups()).items).toHaveLength(1);
    });
  });

  describe("the schedule (G1)", () => {
    it("runs on the owner's schedule, from a v6.3 cron or the new settings", async () => {
      // Every 6 hours from 01:00: the latest slot gets one scheduled backup.
      await backups.updateBackupConfig(owner, {
        schedule: { mode: "HOURS", every: 6, times: ["01:00"] },
      });
      const overview = await backups.getBackupOverview();
      expect(overview.config.scheduleText).toBe(
        "Every 6 hours from 01:00 (01:00, 07:00, 13:00 and 19:00)",
      );
      expect(overview.config.nextRunAt!.getTime() - Date.now()).toBeLessThanOrEqual(6 * 3_600_000);
      const first = await backupTick();
      expect(first).toMatchObject({ trigger: "SCHEDULED", status: "SUCCEEDED" });
      expect(await backupTick()).toBeNull();
      await backups.updateBackupConfig(owner, { cronSchedule: "30 3 * * 1,4" });
      expect((await backups.getBackupOverview()).config.schedule).toMatchObject({
        mode: "WEEKLY",
        weekdays: [1, 4],
        times: ["03:30"],
      });
      await expectAppError(
        backups.updateBackupConfig(owner, { cronSchedule: "0 25 * * *" }),
        "VALIDATION",
      );
      expect(
        (
          await prisma.auditLog.findFirst({
            where: { entityType: "BackupConfig" },
            orderBy: { createdAt: "desc" },
          })
        )?.summary,
      ).toBe("Changed backup settings: schedule: Every Monday and Thursday at 03:30");
    });

    it("turns v6.3's default into twice a day when the migration has run", async () => {
      const config = await backups.getBackupConfig();
      await prisma.backupConfig.update({
        where: { id: config.id },
        data: { scheduleMode: null, cronSchedule: "0 2 * * *" },
      });
      expect((await backups.getBackupOverview()).config.scheduleText).toBe(
        "Every day at 02:00 and 14:00",
      );
      await prisma.backupConfig.update({
        where: { id: config.id },
        data: { scheduleMode: null, cronSchedule: "15 4 * * *" },
      });
      expect((await backups.getBackupOverview()).config.scheduleText).toBe("Every day at 04:15");
      expect((await backups.getBackupConfig()).scheduleMode).toBe("DAYS");
    });
  });

  describe("the screen's status line and the owner's alerts (G10)", () => {
    it("says how much work could be lost, and tells the owner once per problem", async () => {
      expect((await backupHealth()).line).toBe("No backup yet");
      await connectDrive();
      await setKey();
      await backUpNow();
      const ok = await backupHealth();
      expect(ok.line).toBe("Last backup just now, safe in Google Drive");
      expect(ok.loseLine).toBe("If the server is lost now, you lose at most 1 hour of work.");
      await prisma.backupRun.updateMany({ data: { startedAt: hoursAgo(4.6) } });
      expect((await backupHealth()).loseLine).toBe(
        "If the server is lost now, you lose at most 5 hours of work.",
      );
      // (Twice a day: the 4.6-hour-old backup missed a scheduled time, so it is late too.)

      // Two failures in a row: one alert. Then the backups work: one "working again".
      vi.stubEnv("PG_DUMP_PATH", path.join(dir, "missing", "pg_dump"));
      await backUpNow();
      await backUpNow();
      await watchBackups();
      expect((await inbox()).filter((s) => s === "Backup failed")).toHaveLength(1);
      expect((await backupHealth()).line).toMatch(
        /^The last backup failed just now: pg_dump was not found/,
      );
      vi.stubEnv("PG_DUMP_PATH", "");
      await backUpNow();
      await watchBackups();
      await watchBackups();
      expect((await inbox()).filter((s) => s === "Backups are working again")).toHaveLength(1);
    });

    it("tells the owner when a scheduled backup is late", async () => {
      // A schedule whose time passed 3 hours ago with no backup since.
      const at = new Date(Date.now() - 3 * 3_600_000);
      const hhmm = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Dhaka",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(at);
      await backups.updateBackupConfig(owner, {
        schedule: { mode: "DAYS", every: 1, times: [hhmm] },
      });
      // Backups had been running: the last one was a day before.
      const old = await backUpNow();
      await prisma.backupRun.update({ where: { id: old.id }, data: { startedAt: hoursAgo(27) } });
      const health = await backupHealth();
      expect(health.problem?.kind).toBe("late");
      expect(health.line).toMatch(/has not started: is the server running\?$/);
      await watchBackups();
      await watchBackups();
      expect((await inbox()).filter((s) => s === "Backup is late")).toHaveLength(1);
      // Switched off: not late.
      await backups.updateBackupConfig(owner, { isEnabled: false });
      expect((await backupHealth()).problem).toBeNull();
    });
  });

  describe("the one command for a new server (G8, A8)", () => {
    it("is pinned to the running commit and the script's checksum, and holds no secret", async () => {
      expect((await backups.getBackupOverview()).newServer.command).toBeNull();
      await prepareHost(null);
      await backups.setGoogleClient(owner, {
        clientId: "owner-client.apps.googleusercontent.com",
        clientSecret: "GOCSPX-the-owners-secret",
      });
      const { newServer } = await backups.getBackupOverview();
      // Four lines, each but the last ending in "&&": a PDF may copy them as one line or four.
      expect(newServer.commandLines).toEqual([
        `c=${COMMIT} &&`,
        "curl -fsSL https://raw.githubusercontent.com/mehadih32/Extas-ERP/$c/deploy/bootstrap.sh -o restore.sh &&",
        `echo "${BOOTSTRAP_SHA} restore.sh" | sha256sum -c &&`,
        "sudo bash restore.sh $c",
      ]);
      expect(newServer.command).toBe(newServer.commandLines!.join(" "));
      expect(newServer.command).not.toContain("GOCSPX");
      expect(newServer.command).not.toMatch(/token|secret|GITHUB_|Authorization/i);
    });
  });

  describe("Cloudflare (G9)", () => {
    let cf: FakeCloudflare;
    beforeEach(async () => {
      cf = await startFakeCloudflare({
        zones: ["extasbd.com", "other.com"],
        tokens: {
          [CF_TOKEN]: ["extasbd.com"],
          wide_token_for_every_zone_0123456789: ["extasbd.com", "other.com"],
        },
      });
      vi.stubEnv("CLOUDFLARE_API_BASE", cf.url);
      await setPin(ctx, { pin: PIN });
    });
    afterEach(async () => {
      await cf.close();
    });

    it("saves the token sealed after Cloudflare accepts it, and never shows it again", async () => {
      await expectAppError(
        cloudflare.setCloudflare(ctx, { zone: "extasbd.com", token: CF_TOKEN }),
        "VALIDATION",
      );
      const refused = await expectAppError(
        cloudflare.setCloudflare(ctx, {
          pin: PIN,
          zone: "extasbd.com",
          token: "wrong_token_0123456789_0123456789",
        }),
        "UNAVAILABLE",
      );
      expect(refused.message).toMatch(/Cloudflare refused the token/);
      const wide = await expectAppError(
        cloudflare.setCloudflare(ctx, {
          pin: PIN,
          zone: "extasbd.com",
          token: "wide_token_for_every_zone_0123456789",
        }),
        "UNAVAILABLE",
      );
      expect(wide.message).toBe(
        'This token can reach 2 domains: make one for extasbd.com only (step 6, "Specific zone").',
      );
      cf.zones.get("extasbd.com")!.records.push({
        id: "r1",
        type: "A",
        name: "erp.extasbd.com",
        content: "20.1.2.3",
        proxied: true,
        ttl: 1,
      });
      const saved = await cloudflare.setCloudflare(ctx, {
        pin: PIN,
        zone: "ExtasBD.com",
        token: CF_TOKEN,
      });
      expect(saved.config.cloudflare).toMatchObject({
        set: true,
        zone: "extasbd.com",
        tokenHint: "abcd",
      });
      expect(saved.records).toEqual([
        { name: "erp.extasbd.com", content: "20.1.2.3", proxied: true },
      ]);
      const config = await backups.getBackupConfig();
      expect(config.cloudflareTokenRef).toMatch(/^v1:/);
      expect(JSON.stringify(config)).not.toContain(CF_TOKEN);
      expect(JSON.stringify(await backups.getBackupOverview())).not.toContain(CF_TOKEN);
      expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(CF_TOKEN);
      const tested = await cloudflare.testCloudflare(owner);
      expect(tested.config.cloudflare.checkedAt).not.toBeNull();
      // Nothing was changed at Cloudflare.
      expect(cf.requests.filter((r) => !r.startsWith("GET"))).toEqual([]);
      const cleared = await cloudflare.clearCloudflare(ctx, { pin: PIN });
      expect(cleared.cloudflare).toMatchObject({ set: false, zone: null, tokenHint: null });
    });
  });

  describe("the monthly drill (G11)", () => {
    it("restores the newest backup into a temporary database only, and compares everything", async () => {
      await connectDrive();
      await setKey();
      await prepareHost(backupLock(await backups.getBackupConfig())!.key as PublicKey);
      const backup = await backUpNow();
      const drilled = await runTestRestore({ trigger: "MANUAL", actor: owner, wait: true });
      expect(drilled).toMatchObject({
        kind: "TEST_RESTORE",
        status: "SUCCEEDED",
        sourceName: backup.name,
      });
      const manifest = await manifestOf(backup.id);
      expect(drilled.report).toMatchObject({
        mode: "full",
        records: { expected: manifest.records, back: manifest.records },
        files: { expected: 2, back: 2 },
        problems: [],
        ledgerBalanced: true,
      });
      const left = await prisma.$queryRaw<Array<{ datname: string }>>`
        SELECT datname FROM pg_database WHERE datname LIKE ${`${TEST_DB_PREFIX}%`}`;
      expect(left).toEqual([]);
      expect(await inbox()).toContain("Restore drill worked");
      const note = await prisma.notificationLog.findFirst({
        where: { subject: "Restore drill worked" },
      });
      expect(note?.body).toContain(`All ${manifest.records} records and 2 files are back`);

      // Monthly: once per month's slot.
      await prisma.backupRun.deleteMany({ where: { kind: "TEST_RESTORE" } });
      expect(await testRestoreTick()).toMatchObject({ kind: "TEST_RESTORE", trigger: "SCHEDULED" });
      expect(await testRestoreTick()).toBeNull();
    });

    it("checks checksums only without the key, and uses a typed key once", async () => {
      await connectDrive();
      await setKey({ keepInDrive: false });
      expect(labelled("restore-key")).toEqual([]);
      await backUpNow();
      const partial = await runTestRestore({ trigger: "MANUAL", actor: owner, wait: true });
      expect(partial.status).toBe("SUCCEEDED");
      expect(partial.report).toMatchObject({
        mode: "checksums",
        problems: [],
        note: "The full drill needs your recovery key: keep it in Google Drive, or type it in Run drill now.",
      });
      expect(await inbox()).toContain("Restore drill: checksums only");
      // A damaged file in Drive is found.
      const locked = [...google.files.values()].find((f) => f.name === "database.dump.locked")!;
      locked.data![100]! ^= 1;
      const damaged = await runTestRestore({ trigger: "MANUAL", actor: owner, wait: true });
      expect(damaged.status).toBe("FAILED");
      expect(damaged.error).toMatch(
        /database\.dump\.locked in Drive is not the file that was backed up/,
      );
      locked.data![100]! ^= 1;
      const full = await runTestRestore({
        trigger: "MANUAL",
        actor: owner,
        wait: true,
        recoveryKey: OWNER_KEY,
      });
      expect(full.report).toMatchObject({ mode: "full", problems: [] });
      expect(
        JSON.stringify(await prisma.backupRun.findMany(), (_k, v: unknown) =>
          typeof v === "bigint" ? String(v) : v,
        ),
      ).not.toContain("Padma");
      expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain("Padma");
    });
  });

  describe("restore from the screen", () => {
    it("opens a v6.4 backup with the key kept in Drive, or the key typed", async () => {
      await connectDrive();
      await setKey();
      const backup = await backUpNow();
      await writeFile(path.join(backupDir, ".restore-helper"), "");
      const [drv] = (await listDriveBackups()).items;
      await requestRestore(ctx, { folderId: drv!.folderId, pin: PIN, confirm: "RESTORE" });
      const opened = path.join(backupDir, "restores", backup.name!);
      expect((await readdir(opened)).sort()).toEqual([
        "database.dump",
        "manifest.json",
        "media.tar.gz",
      ]);
      // Without the key in Drive, the typed key must be right.
      await rm(path.join(backupDir, "restore-request.json"));
      await keys.setKeepKeyInDrive(ctx, { pin: PIN, keep: false });
      await prisma.backupRun.deleteMany({ where: { kind: "RESTORE" } });
      const wrong = await expectAppError(
        requestRestore(ctx, {
          folderId: drv!.folderId,
          pin: PIN,
          confirm: "RESTORE",
          key: "wrong key here",
        }),
        "VALIDATION",
      );
      expect(wrong.details).toEqual({
        key: ["This recovery key is not the one these backups were locked with."],
      });
      await requestRestore(ctx, {
        folderId: drv!.folderId,
        pin: PIN,
        confirm: "RESTORE",
        key: OWNER_KEY,
      });
    });
  });
});
