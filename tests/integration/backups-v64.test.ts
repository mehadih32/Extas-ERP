import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import { backupLock, driveToken, hostRoot } from "@/modules/backups/backup-core";
import * as backups from "@/modules/backups/backup.service";
import * as cloudflare from "@/modules/backups/cloudflare";
import { afterRestore, RESTORED_MARK } from "@/modules/backups/after-restore";
import { countTables } from "@/modules/backups/contents";
import { disk, DISK_MARGIN_BYTES } from "@/modules/backups/disk";
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
import { guideTick } from "@/modules/backups/guide.service";
import { parseKeyFile } from "@/modules/backups/keys";
import * as keys from "@/modules/backups/recovery-key.service";
import { requestRestore } from "@/modules/backups/restore.service";
import { backupClock, backupTick, testRestoreTick } from "@/modules/backups/scheduler";
import { onStandby, STANDBY_MARK, standbyMark } from "@/modules/backups/standby";
import { backupHealth, watchBackups } from "@/modules/backups/status";
import { drillDatabasePrefix, runTestRestore } from "@/modules/backups/test-restore";
import { housekeepingTick } from "@/modules/housekeeping/scheduler";
import { claimNextJob } from "@/modules/jobs/queue";
import { jobTick } from "@/modules/jobs/worker";
import { reminderTick } from "@/modules/reminders/scheduler";

import { type FakeCloudflare, startFakeCloudflare } from "../../scripts/fake-cloudflare";
import { type FakeGoogle, startFakeGoogle } from "../../scripts/fake-google";
import { pdfLines } from "../fixtures/pdf";
import { makeCodeBundle } from "./code-bundle-fixture";
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
/** The code at the running version: a real git bundle and its commit (G15). */
let COMMIT: string;
let CODE_BUNDLE: Buffer;
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
  beforeAll(async () => {
    ({ commit: COMMIT, bundle: CODE_BUNDLE } = await makeCodeBundle());
  });
  let dir: string;
  let backupDir: string;
  let uploadDir: string;
  let owner: { userId: string };
  let ctx: CompanyContext;
  let google: FakeGoogle;

  beforeEach(async () => {
    // The machine's own free disk never decides these tests (G7 has its own).
    vi.spyOn(disk, "freeBytes").mockResolvedValue(null);
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
    code: Buffer = CODE_BUNDLE,
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
    await writeFile(path.join(host, "code.bundle"), code);
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

    it("says which uploaded files are links it does not hold, instead of leaving them out without a word", async () => {
      await writeFile(path.join(dir, "kept-elsewhere.pdf"), "a file outside the uploads");
      await symlink(
        path.join(dir, "kept-elsewhere.pdf"),
        path.join(uploadDir, "c1", "2026", "10", "linked.pdf"),
      );
      const done = await backUpNow();
      const manifest = await manifestOf(done.id);
      expect(manifest.uploads.map((u) => u.path)).not.toContain("c1/2026/10/linked.pdf");
      expect(manifest.missing).toContain(
        "1 link(s) among the uploaded files (a link points to a file kept somewhere else, so it is not in the backup): c1/2026/10/linked.pdf.",
      );
      expect(done.report).toMatchObject({ missing: manifest.missing });
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
      expect(await readFile(opened.code!)).toEqual(CODE_BUNDLE);
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
      await connectDrive();
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

      // G3: Drive keeps one restore-key.json per pair, so the old backups still open.
      const newPair = forgot.config.recoveryKey.pairId!;
      const copies = () =>
        labelled("restore-key").map((f) => ({
          pair: f.appProperties.pairId,
          key: (JSON.parse(f.data!.toString()) as { recoveryKey: string }).recoveryKey,
        }));
      expect(copies()).toEqual([
        { pair: oldPair, key: OWNER_KEY },
        { pair: newPair, key: "my second key, written down" },
      ]);
      expect(await keys.recoveryKeyFromDrive(await backups.getBackupConfig())).toBe(
        "my second key, written down",
      );
      const guide = pdfLines(labelled("guide-en")[0]!.data!).join("\n");
      expect(guide).toContain("my second key, written down");
      expect(guide).not.toContain(OWNER_KEY);

      // Changed again (same pair): that pair's older copy goes; the old pair's stays.
      await keys.setRecoveryKey(ctx, {
        pin: PIN,
        key: "my third key, also written",
        confirm: "my third key, also written",
        currentKey: "my second key, written down",
      });
      expect(copies()).toEqual([
        { pair: oldPair, key: OWNER_KEY },
        { pair: newPair, key: "my third key, also written" },
      ]);

      // A stale copy (an older key of this pair, made last) is never used or printed.
      const root = rootFiles().find((f) => f.appProperties.extas === "restore-key")!;
      google.files.set("stale", {
        ...root,
        id: "stale",
        appProperties: { extas: "restore-key", pairId: newPair },
        createdTime: new Date(Date.now() + 60_000).toISOString(),
        data: Buffer.from(
          JSON.stringify({
            app: "Extas ERP",
            kind: "restore-key",
            pairId: newPair,
            recoveryKey: "my second key, written down",
            savedAt: new Date().toISOString(),
          }),
        ),
      });
      expect(await keys.recoveryKeyFromDrive(await backups.getBackupConfig())).toBe(
        "my third key, also written",
      );
      expect(await guideTick(new Date(Date.now() + 40 * 86_400_000))).toBe("made");
      const later = pdfLines(labelled("guide-en")[0]!.data!).join("\n");
      expect(later).toContain("my third key, also written");
      expect(later).not.toContain("my second key, written down");
      expect(later).not.toContain(OWNER_KEY);

      // Taken out of Drive: every copy goes.
      await keys.setKeepKeyInDrive(ctx, { pin: PIN, keep: false });
      expect(labelled("restore-key")).toEqual([]);
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

    it("keeps the newest 3 backups in Drive: each new one, once checked, replaces the oldest (2026-10-30)", async () => {
      await connectDrive();
      await setKey();
      const made = [];
      for (let i = 0; i < 3; i += 1) made.push(await backUpNow());
      expect((await listDriveBackups()).items).toHaveLength(3);
      // Not checked in Drive yet: the oldest stays until the new one is.
      const { pruneBackups } = await import("@/modules/backups/drive-copies");
      const d = await backUpNow();
      let names = (await listDriveBackups()).items.map((x) => x.name);
      expect(names).toHaveLength(3);
      expect(names).not.toContain(made[0]!.name);
      expect(names).toEqual(expect.arrayContaining([made[1]!.name, made[2]!.name, d.name]));
      for (const f of google.files.values()) {
        if (f.name === d.name) delete f.appProperties.checked;
      }
      await pruneBackups(await backups.getBackupConfig());
      names = (await listDriveBackups()).items.map((x) => x.name);
      expect(names).toEqual(expect.arrayContaining([made[1]!.name, made[2]!.name]));
      // However old they are, the newest 3 stay.
      for (const f of google.files.values()) {
        if (f.appProperties.extas === "backup") {
          f.appProperties.checked = "yes";
          f.appProperties.createdAt = new Date(Date.now() - 400 * 86_400_000).toISOString();
        }
      }
      await pruneBackups(await backups.getBackupConfig());
      expect((await listDriveBackups()).items).toHaveLength(3);
    });

    it("never lets another ERP at a new address push this one's backups out of Drive (review 2026-10-30)", async () => {
      await connectDrive();
      await setKey();
      const before = process.env.APP_URL;
      try {
        // An ERP restored at a new address (--domain) while this one still runs.
        process.env.APP_URL = "https://erp.newcompany.com";
        const theirs = [];
        for (let i = 0; i < 4; i += 1) theirs.push(await backUpNow());
        process.env.APP_URL = "https://erp.extasbd.com";
        const ours = [await backUpNow()];
        let names = (await listDriveBackups()).items.map((x) => x.name);
        // Each keeps its own newest 3: theirs never push ours out, nor ours theirs.
        expect(names).toEqual(
          expect.arrayContaining([...theirs.slice(1), ...ours].map((r) => r.name)),
        );
        expect(names).not.toContain(theirs[0]!.name);
        for (let i = 0; i < 2; i += 1) ours.push(await backUpNow());
        // That ERP made none for 30 days, and this one has its 3: theirs go.
        for (const f of google.files.values()) {
          if (f.appProperties.site === "erp.newcompany.com")
            f.appProperties.createdAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
        }
        const { pruneBackups } = await import("@/modules/backups/drive-copies");
        await pruneBackups(await backups.getBackupConfig());
        names = (await listDriveBackups()).items.map((x) => x.name);
        expect(names.sort()).toEqual(ours.map((r) => r.name).sort());
      } finally {
        process.env.APP_URL = before;
      }
    });
  });

  describe("the backups folder in Drive (v6.4.1 review)", () => {
    it("finds the first one made again when two carry the label, never a newer stray one", async () => {
      await connectDrive();
      const config = await backups.getBackupConfig();
      const token = (await driveToken(config))!;
      const folder = (id: string, createdTime: string) =>
        google.files.set(id, {
          id,
          name: "Extas ERP Backups",
          mimeType: "application/vnd.google-apps.folder",
          parents: ["root"],
          appProperties: { extas: "backups" },
          createdTime,
          trashed: false,
          data: null,
        });
      folder("root-first", "2026-01-01T00:00:00.000Z");
      folder("root-later", "2026-09-01T00:00:00.000Z");
      await prisma.backupConfig.update({
        where: { id: config.id },
        data: { googleDriveFolderId: null },
      });
      const { driveRoot } = await import("@/modules/backups/backup-core");
      expect(await driveRoot(await backups.getBackupConfig(), token)).toBe("root-first");
      expect((await backups.getBackupConfig()).googleDriveFolderId).toBe("root-first");
    });
  });

  describe("keeping on a copy on standby (v6.4.1 review)", () => {
    it("removes only its own standby backups from Drive, never the ERP in use's", async () => {
      await connectDrive();
      await setKey();
      // The ERP in use: two backups.
      const a = await backUpNow();
      const b = await backUpNow();
      // A restored copy on standby backs up into the same Drive folder.
      await writeFile(path.join(backupDir, STANDBY_MARK), "3f9a0c1d2e4b5a69");
      const standby = [];
      for (let i = 0; i < 4; i += 1) standby.push(await backUpNow());
      expect(standby[0]!.name).toMatch(/_standby$/);
      const names = (await listDriveBackups()).items.map((x) => x.name);
      // Its own newest 3 stay; the ERP in use's are never counted with them, nor removed.
      expect(names).toEqual(
        expect.arrayContaining([a.name, b.name, ...standby.slice(1).map((r) => r.name)]),
      );
      expect(names).not.toContain(standby[0]!.name);
    });
  });

  describe("making the backups less safe needs the PIN and tells the owner (R-BAK G12)", () => {
    const told = async () => (await inbox()).filter((s) => s === "Backups made less safe");

    it("switching backups off", async () => {
      // No PIN yet: the screen shows "set your PIN first".
      const noPin = await expectAppError(
        backups.updateBackupConfig(ctx, { isEnabled: false }),
        "VALIDATION",
      );
      expect(Object.keys(noPin.details ?? {})).toEqual(["pinNotSet"]);
      await setPin(ctx, { pin: PIN });
      const missing = await expectAppError(
        backups.updateBackupConfig(ctx, { isEnabled: false }),
        "VALIDATION",
      );
      expect(missing.message).toBe("Give your PIN to switch backups off.");
      await expectAppError(
        backups.updateBackupConfig(ctx, { isEnabled: false, pin: "1111" }),
        "VALIDATION",
      );
      // Only the platform owner in a company can give the PIN.
      await expectAppError(
        backups.updateBackupConfig(owner, { isEnabled: false, pin: PIN }),
        "FORBIDDEN",
      );
      expect((await backups.getBackupConfig()).isEnabled).toBe(true);
      expect(await told()).toEqual([]);

      await backups.updateBackupConfig(ctx, { isEnabled: false, pin: PIN });
      expect((await backups.getBackupConfig()).isEnabled).toBe(false);
      expect(await told()).toHaveLength(1);
      const alert = await prisma.notificationLog.findFirstOrThrow({
        where: { subject: "Backups made less safe" },
      });
      expect(alert.body).toMatch(/switched backups off/);
      expect(alert.body).not.toContain(PIN);

      // Safer changes, and other settings, need no PIN and tell no one.
      await backups.updateBackupConfig(owner, { isEnabled: true });
      await backups.updateBackupConfig(owner, {
        schedule: { mode: "DAYS", every: 1, times: ["03:00"] },
        serverKeep: 5,
      });
      expect(await told()).toHaveLength(1);

      // Days in Drive are no longer a setting (Drive keeps the newest 3): ignored, no PIN.
      await backups.updateBackupConfig(ctx, { driveKeepDays: 7 } as never);
      expect(await told()).toHaveLength(1);
      const audit = await prisma.auditLog.findMany({ where: { entityType: "BackupConfig" } });
      expect(JSON.stringify(audit)).not.toContain(PIN);
    });

    it("disconnecting Google Drive", async () => {
      await connectDrive();
      await setPin(ctx, { pin: PIN });
      await expectAppError(backups.disconnectGoogleDrive(ctx, {}), "VALIDATION");
      await expectAppError(backups.disconnectGoogleDrive(owner, { pin: PIN }), "FORBIDDEN");
      expect((await backups.getBackupConfig()).credentialsRef).not.toBeNull();
      const off = await backups.disconnectGoogleDrive(ctx, { pin: PIN });
      expect(off.googleDrive.connected).toBe(false);
      expect(await told()).toHaveLength(1);
      const alert = await prisma.notificationLog.findFirstOrThrow({
        where: { subject: "Backups made less safe" },
      });
      expect(alert.body).toMatch(/disconnected Google Drive/);
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
      await setPin(ctx, { pin: PIN });
      await backups.updateBackupConfig(ctx, { isEnabled: false, pin: PIN });
      expect((await backupHealth()).problem).toBeNull();
    });
  });

  describe("free disk before a backup or a drill (R-BAK G7)", () => {
    it("skips a backup without twice the last backup's size and a margin free, and tells the owner once", async () => {
      const done = await backUpNow();
      expect(done.status).toBe("SUCCEEDED");
      const last = Number(
        (await prisma.backupRun.findUniqueOrThrow({ where: { id: done.id } })).sizeBytes,
      );
      const free = vi.spyOn(disk, "freeBytes");
      free.mockResolvedValue(2 * last + DISK_MARGIN_BYTES - 1);
      const skipped = await backUpNow();
      expect(skipped.status).toBe("FAILED");
      expect(skipped.error).toMatch(
        /^Skipped: the server has .* free, and a backup needs at least/,
      );
      expect(await readdir(backupDir)).not.toContain(skipped.name);
      await backUpNow();
      await watchBackups();
      expect((await inbox()).filter((s) => s?.startsWith("Backup"))).toEqual([
        "Backup skipped: the server's disk is nearly full",
      ]);
      // Enough room again (or a disk that cannot be measured): backups run.
      free.mockResolvedValue(2 * last + DISK_MARGIN_BYTES + 1);
      expect((await backUpNow()).status).toBe("SUCCEEDED");
      free.mockResolvedValue(null);
      expect((await backUpNow()).status).toBe("SUCCEEDED");
    });

    it("skips the drill without room for the backup it downloads", async () => {
      await connectDrive();
      await setKey();
      await prepareHost(backupLock(await backups.getBackupConfig())!.key as PublicKey);
      const backup = await backUpNow();
      vi.spyOn(disk, "freeBytes").mockResolvedValue(DISK_MARGIN_BYTES);
      const drilled = await runTestRestore({ trigger: "MANUAL", actor: owner, wait: true });
      expect(drilled).toMatchObject({ status: "FAILED", sourceName: backup.name });
      expect(drilled.error).toMatch(/^Skipped: the server has .* free, and a restore drill needs/);
      const left = await prisma.$queryRaw<Array<{ datname: string }>>`
        SELECT datname FROM pg_database WHERE starts_with(datname, ${drillDatabasePrefix()})`;
      expect(left).toEqual([]);
      expect(await inbox()).toContain("Restore drill skipped: the server's disk is nearly full");
      expect(await inbox()).not.toContain("Restore drill failed");
    });
  });

  describe("the one command for a new server (G8, A8)", () => {
    it("is pinned to the running commit and the script's checksum, and holds no secret", async () => {
      expect((await backups.getBackupOverview()).newServer.command).toBeNull();
      await prepareHost(null);
      await setPin(ctx, { pin: PIN });
      await backups.setGoogleClient(ctx, {
        clientId: "owner-client.apps.googleusercontent.com",
        clientSecret: "GOCSPX-the-owners-secret",
        pin: PIN,
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
    it("drops only this ERP's own temporary databases, never another ERP's on the same server", async () => {
      const mine = drillDatabasePrefix();
      expect(mine).toMatch(/^extas_restore_test_[0-9a-f]{8}_$/);
      // Another ERP on the same database server (another live database name).
      const theirs = drillDatabasePrefix("another_erp");
      expect(theirs).not.toBe(mine);
      const leftover = `${mine}leftover`;
      const other = `${theirs}drilling`;
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${other}"`);
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${leftover}"`);
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${other}"`);
      try {
        await connectDrive();
        await setKey();
        await prepareHost(backupLock(await backups.getBackupConfig())!.key as PublicKey);
        await backUpNow();
        const drilled = await runTestRestore({ trigger: "MANUAL", actor: owner, wait: true });
        expect(drilled.status).toBe("SUCCEEDED");
        const names = (
          await prisma.$queryRaw<Array<{ datname: string }>>`SELECT datname FROM pg_database`
        ).map((d) => d.datname);
        expect(names.filter((n) => n.startsWith(mine))).toEqual([]);
        expect(names).toContain(other);
      } finally {
        await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${other}"`);
        await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${leftover}"`);
      }
    });

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
        code: "whole",
        problems: [],
        ledgerBalanced: true,
      });
      const left = await prisma.$queryRaw<Array<{ datname: string }>>`
        SELECT datname FROM pg_database WHERE starts_with(datname, ${drillDatabasePrefix()})`;
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

    it("finds a damaged code bundle in the backup (G15)", async () => {
      await connectDrive();
      await setKey();
      const spoiled = Buffer.from(CODE_BUNDLE);
      spoiled[spoiled.length - 30]! ^= 1;
      await prepareHost(
        backupLock(await backups.getBackupConfig())!.key as PublicKey,
        undefined,
        spoiled,
      );
      await backUpNow();
      const drilled = await runTestRestore({ trigger: "MANUAL", actor: owner, wait: true });
      expect(drilled.status).toBe("FAILED");
      expect(drilled.report).toMatchObject({ code: "the code in the backup is damaged" });
      expect(drilled.error).toContain("the code in the backup is damaged");
      expect(await inbox()).toContain("Restore drill failed");
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

  describe("standby after a restore on a second server (G2)", () => {
    it("keeps backing up and sending alarms on standby; its reminders and messages wait", async () => {
      await connectDrive();
      await setKey();
      await mkdir(backupDir, { recursive: true });
      await writeFile(path.join(backupDir, STANDBY_MARK), "3f9a0c1d2e4b5a69");
      expect(await onStandby()).toBe(true);
      const mark = await standbyMark();
      expect(mark?.id).toBe(sha256("3f9a0c1d2e4b5a69").slice(0, 16));

      // The files beside the backups in Drive (keys, restore guide, restore.sh, restore-tool.py)
      // belong to the ERP in use: the copy on standby never puts or replaces them.
      const rootLabels = ["keys", "guide-bn", "guide-en", "restore-script", "restore-tool"];
      const rootFiles = () =>
        [...google.files.values()]
          .filter((f) => !f.trashed && rootLabels.includes(String(f.appProperties?.extas)))
          .map((f) => f.id)
          .sort();
      for (const f of google.files.values()) {
        if (f.appProperties?.extas === "keys") google.files.delete(f.id);
      }
      const before = rootFiles();

      // A backup is due (none yet): the copy on standby makes it, under a name of its own,
      // marked as made on standby here and in Drive (Enter never picks it in a restore).
      await backupClock();
      const run = await prisma.backupRun.findFirst({ where: { kind: "BACKUP" } });
      expect(run).not.toBeNull();
      const made = await backUpNow();
      expect(made.status).toBe("SUCCEEDED");
      expect(made.name).toMatch(/_standby$/);
      expect((await manifestOf(made.id)) as Manifest & { standby?: boolean }).toMatchObject({
        standby: true,
      });
      const inDrive = [...google.files.values()].find((f) => f.name === made.name)!;
      expect(inDrive.appProperties).toMatchObject({
        extas: "backup",
        standby: "yes",
        checked: "yes",
      });
      await backupClock();
      expect(rootFiles()).toEqual(before);
      // Said on the Backups screen (after any backup problem) and on every page.
      expect((await backupHealth()).line).toMatch(/^On standby after a restore/);
      const layout = await readFile(path.join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
      expect(layout).toMatch(/\{standby \? <StandbyBar \/> : null\}/);

      // The job queue sends only the alarms raised since the copy went on standby: not the
      // backup's own queue (messages it sent already), nor anything else.
      expect(await housekeepingTick()).toBeNull();
      const waiting = [
        await prisma.backgroundJob.create({
          data: {
            kind: "ai.bot.push",
            payload: { kind: "text", text: "from the backup", alarm: true },
            createdAt: hoursAgo(3),
          },
        }),
        await prisma.backgroundJob.create({
          data: { kind: "ai.bot.push", payload: { kind: "text", text: "a reminder" } },
        }),
        await prisma.backgroundJob.create({ data: { kind: "terms.pdf", payload: {} } }),
      ];
      const alarm = await prisma.backgroundJob.create({
        data: {
          kind: "ai.bot.push",
          payload: { kind: "text", text: "Backup failed", alarm: true },
        },
      });
      const only = { alarmsSince: mark!.since };
      expect((await claimNextJob(new Date(), "test", only))?.id).toBe(alarm.id);
      expect(await claimNextJob(new Date(), "test", only)).toBeNull();
      expect(await jobTick()).not.toBeNull();
      expect(
        await prisma.backgroundJob.count({
          where: { id: { in: waiting.map((j) => j.id) }, status: "QUEUED" },
        }),
      ).toBe(3);

      // The reminder clock runs Bug Guard (the check the restore asked for, G1), nothing else.
      await writeFile(
        path.join(backupDir, "bug-guard-request.json"),
        JSON.stringify({ requestedAt: "2026-10-17T00:00:00.000000000Z" }),
      );
      expect(await reminderTick()).toBeNull();
      // Bug Guard runs in the background: on a busy machine it takes more than the
      // default 1 second to write its result.
      await vi.waitFor(
        async () =>
          expect(
            JSON.parse(await readFile(path.join(backupDir, "bug-guard-result.json"), "utf8")),
          ).toMatchObject({ requestedAt: "2026-10-17T00:00:00.000000000Z" }),
        { timeout: 15_000, interval: 200 },
      );

      // go-live.sh takes the mark away: everything runs, backups under their usual names.
      await rm(path.join(backupDir, STANDBY_MARK));
      expect(await onStandby()).toBe(false);
      expect(await standbyMark()).toBeNull();
      const live = await backUpNow();
      expect(live.name).not.toMatch(/standby/);
      expect((await backupHealth()).line).not.toMatch(/standby/);
      expect(await jobTick()).not.toBeNull();
    }, 180_000);
  });

  describe("restore from the screen", () => {
    it("keeps this server's recovery key, schedule and Drive, and closes the runs the backup left open (G4, G5)", async () => {
      await connectDrive();
      await setKey();
      await backups.updateBackupConfig(owner, {
        schedule: { mode: "HOURS", every: 4, times: ["01:00"] },
        serverKeep: 6,
      });
      const backup = await backUpNow();
      const live = await backups.getBackupConfig();
      // What restore.sh saves just before the restore, with its own query.
      const query = /^KEEP_SQL='([^']+)'$/m.exec(
        await readFile(path.join(process.cwd(), "deploy", "restore.sh"), "utf8"),
      )?.[1];
      expect(query).toBeTruthy();
      const [kept] = await prisma.$queryRawUnsafe<Array<{ row_to_json: unknown }>>(query!);

      // The restored database: an older backup, before the key and Drive were set,
      // holding its own run (and a safety copy's) as still running.
      await prisma.backupConfig.update({
        where: { id: live.id },
        data: {
          keyPairId: null,
          publicKey: null,
          lockedKeyFile: null,
          keySetAt: null,
          credentialsRef: null,
          googleDriveAccount: null,
          scheduleMode: "DAYS",
          scheduleEvery: 1,
          isEnabled: false,
          serverKeep: 3,
        },
      });
      await prisma.backupRun.update({
        where: { id: backup.id },
        data: {
          status: "RUNNING",
          finishedAt: null,
          name: null,
          checkedAt: null,
          driveFileId: null,
        },
      });
      const stuck = await prisma.backupRun.create({
        data: {
          trigger: "SCHEDULED",
          kind: "SAFETY_COPY",
          status: "RUNNING",
          startedAt: hoursAgo(1),
        },
      });
      await rm(path.join(backupDir, "backup-public-key.json"), { force: true });
      await writeFile(
        path.join(backupDir, RESTORED_MARK),
        JSON.stringify({
          name: backup.name,
          fromDrive: true,
          backupCreatedAt: backup.startedAt,
          restoredAt: new Date().toISOString(),
          keptSettings: kept!.row_to_json,
        }),
      );

      expect(await afterRestore()).toEqual({ keptSettings: true, closedRuns: 2 });
      const after = await backups.getBackupConfig();
      for (const field of [
        "keyPairId",
        "publicKey",
        "lockedKeyFile",
        "credentialsRef",
        "googleDriveAccount",
        "googleDriveFolderId",
        "scheduleMode",
        "scheduleEvery",
        "scheduleTimes",
        "isEnabled",
        "serverKeep",
        "keepKeyInDrive",
      ] as const) {
        expect(after[field]).toEqual(live[field]);
      }
      expect(after.keySetAt?.getTime()).toBe(live.keySetAt?.getTime());
      // The server's settings file is locked with the live key again.
      expect(
        JSON.parse(await readFile(path.join(backupDir, "backup-public-key.json"), "utf8")),
      ).toMatchObject({ pairId: live.keyPairId });
      // The backup's own run is done; the other one is closed; a backup can start at once.
      // It came back from Google Drive, so it is there: not sent again, no warning.
      expect(await prisma.backupRun.findUniqueOrThrow({ where: { id: backup.id } })).toMatchObject({
        status: "SUCCEEDED",
        name: backup.name,
        driveError: null,
        checkedAt: expect.any(Date),
      });
      expect((await backupHealth()).level).toBe("good");
      expect(await prisma.backupRun.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({
        status: "FAILED",
        error: expect.stringMatching(/restored/),
      });
      expect((await readdir(backupDir)).filter((n) => n.startsWith(".restored"))).toEqual([]);
      expect(await afterRestore()).toBeNull();
      expect((await backUpNow()).status).toBe("SUCCEEDED");
    });

    it("after a restore on a new server, only closes the open runs", async () => {
      const backup = await backUpNow();
      // A new server: the backup's folder is not on it (it came from Drive).
      await rm(await folderOf(backup.id), { recursive: true });
      await prisma.backupRun.update({
        where: { id: backup.id },
        data: { status: "RUNNING", finishedAt: null, name: null },
      });
      const before = await backups.getBackupConfig();
      await writeFile(
        path.join(backupDir, RESTORED_MARK),
        JSON.stringify({ name: backup.name, backupCreatedAt: null, keptSettings: null }),
      );
      expect(await afterRestore()).toEqual({ keptSettings: false, closedRuns: 1 });
      expect((await backups.getBackupConfig()).updatedAt).toEqual(before.updatedAt);
      const run = await prisma.backupRun.findUniqueOrThrow({ where: { id: backup.id } });
      expect(run).toMatchObject({ status: "SUCCEEDED", name: backup.name, checkedAt: null });
      // Its files are not here: it is never tried again from this server.
      expect(run.filesDeletedAt).toBeInstanceOf(Date);
    });

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
