import { execFile } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import { driveToken } from "@/modules/backups/backup-core";
import * as backups from "@/modules/backups/backup.service";
import {
  fetchBackup,
  listDriveBackups,
  sendSafetyCopies,
  sendUnsent,
} from "@/modules/backups/drive-copies";
import { setRecoveryKey } from "@/modules/backups/recovery-key.service";
import {
  recordRestoreResult,
  requestRestore,
  restoreStatus,
} from "@/modules/backups/restore.service";
import { backupTick, testRestoreTick } from "@/modules/backups/scheduler";
import {
  runTestRestore,
  TEST_DB_PREFIX,
  type TestRestoreReport,
} from "@/modules/backups/test-restore";

import { type FakeGoogle, startFakeGoogle } from "../../scripts/fake-google";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const exec = promisify(execFile);
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const FOLDER = "application/vnd.google-apps.folder";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

run("daily backups", () => {
  let dir: string;
  let backupDir: string;
  let uploadDir: string;
  let owner: { userId: string };

  beforeEach(async () => {
    await resetDb();
    dir = await mkdtemp(path.join(os.tmpdir(), "extras-backups-"));
    backupDir = path.join(dir, "backups");
    uploadDir = path.join(dir, "uploads");
    vi.stubEnv("BACKUP_DIR", backupDir);
    vi.stubEnv("UPLOAD_DIR", uploadDir);
    vi.stubEnv("PG_DUMP_PATH", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "client-123.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("APP_URL", "https://erp.example.com");
    await mkdir(path.join(uploadDir, "logos"), { recursive: true });
    await writeFile(path.join(uploadDir, "logos", "extras.png"), "not really a png");
    owner = { userId: (await makeUser("owner@extras.test", { isSuperAdmin: true })).id };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  /** The folder on the server holding a run's files. */
  async function folderOf(runId: string) {
    const saved = await prisma.backupRun.findUniqueOrThrow({ where: { id: runId } });
    return path.join(backupDir, path.dirname(saved.dbDumpPath!));
  }

  const backUpNow = () => backups.runBackup({ trigger: "MANUAL", actor: owner, wait: true });

  /** Restores a dump into a new, empty database and reads the company names back. */
  async function restoredCompanies(dump: string) {
    const name = `${new URL(process.env.DATABASE_URL!).pathname.slice(1)}_restore`;
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
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
        {
          env,
        },
      );
      const { stdout } = await exec("psql", ["-tAc", 'SELECT name FROM "Company" ORDER BY name'], {
        env,
      });
      return stdout.trim().split("\n");
    } finally {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
    }
  }

  describe("backing up", () => {
    it("saves the database and the uploaded files, ready to restore", async () => {
      await makeCompany("Extras");
      await makeCompany("Extras Kids");
      const done = await backUpNow();
      expect(done).toMatchObject({
        trigger: "MANUAL",
        status: "SUCCEEDED",
        files: { database: true, media: true, manifest: true },
        kind: "BACKUP",
        keyId: null,
        checkedAt: null,
        onGoogleDrive: false,
        // Not locked yet, so it stays on the server and says why.
        driveError:
          "Kept on the server only: set your recovery key on the Backups screen. Backups are locked with it before they go to Google Drive.",
        filesDeletedAt: null,
        error: null,
        triggeredBy: { id: owner.userId, name: "owner" },
      });
      expect(done.finishedAt).not.toBeNull();

      // One dated folder: database.dump, media.tar.gz and manifest.json.
      const folders = await readdir(backupDir);
      expect(folders).toHaveLength(1);
      expect(folders[0]).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}$/);
      const folder = path.join(backupDir, folders[0]!);
      expect((await readdir(folder)).sort()).toEqual([
        "database.dump",
        "manifest.json",
        "media.tar.gz",
      ]);

      // The manifest lists every file with its size and checksum.
      const manifest = JSON.parse(await readFile(path.join(folder, "manifest.json"), "utf8")) as {
        files: Array<{ name: string; bytes: number; sha256: string }>;
      };
      expect(manifest).toMatchObject({
        app: "Extas ERP",
        format: 1,
        timezone: "Asia/Dhaka",
        trigger: "MANUAL",
        companies: 2,
      });
      expect(manifest.files.map((f) => f.name)).toEqual(["database.dump", "media.tar.gz"]);
      let total = 0;
      for (const file of manifest.files) {
        const content = await readFile(path.join(folder, file.name));
        expect(file.bytes).toBe(content.length);
        expect(file.sha256).toBe(sha256(content));
        total += content.length;
      }
      total += (await readFile(path.join(folder, "manifest.json"))).length;
      expect(done.sizeBytes).toBe(total);

      // The dump restores into an empty database, and the files unpack as they were.
      expect(await restoredCompanies(path.join(folder, "database.dump"))).toEqual([
        "Extras",
        "Extras Kids",
      ]);
      const unpacked = path.join(dir, "unpacked");
      await mkdir(unpacked);
      await exec("tar", ["-xzf", path.join(folder, "media.tar.gz"), "-C", unpacked]);
      expect(await readFile(path.join(unpacked, "logos", "extras.png"), "utf8")).toBe(
        "not really a png",
      );

      const overview = await backups.getBackupOverview();
      expect(overview.lastRun?.id).toBe(done.id);
      expect(overview.lastSuccess?.id).toBe(done.id);
      expect(overview.server).toEqual({
        backupDir,
        pgDump: expect.stringMatching(/^pg_dump \(PostgreSQL\) \d+/),
      });
      expect(overview.config).toMatchObject({
        scheduleText: "Every day at 02:00 and 14:00",
        timezone: "Asia/Dhaka",
        serverKeep: 4,
        driveKeepDays: 90,
        isEnabled: true,
        googleDrive: { available: true, connected: false, account: null, folderId: null },
      });
      expect(overview.config.nextRunAt).not.toBeNull();
      expect((await backups.listBackupRuns()).items.map((r) => r.id)).toEqual([done.id]);
      expect(
        await prisma.auditLog.findFirst({
          where: { action: "CREATE", entityType: "BackupRun", entityId: done.id },
        }),
      ).toMatchObject({ userId: owner.userId, companyId: null, summary: "Started backup" });
    });

    it("lets the owner download each file, and records every download", async () => {
      const done = await backUpNow();
      const folder = await folderOf(done.id);
      const stamp = path.basename(folder);

      const dump = await backups.getBackupFile(owner, done.id, "database");
      expect(dump).toEqual({
        path: path.join(folder, "database.dump"),
        fileName: `extras-erp-${stamp}-database.dump`,
        size: (await readFile(path.join(folder, "database.dump"))).length,
        mimeType: "application/octet-stream",
      });
      expect((await readFile(dump.path)).subarray(0, 5).toString()).toBe("PGDMP");
      expect(await backups.getBackupFile(owner, done.id, "manifest")).toMatchObject({
        fileName: `extras-erp-${stamp}-manifest.json`,
        mimeType: "application/json",
      });
      expect(await backups.getBackupFile(owner, done.id, "media")).toMatchObject({
        path: path.join(folder, "media.tar.gz"),
      });

      const downloads = await prisma.auditLog.findMany({
        where: { action: "EXPORT", entityType: "BackupRun", entityId: done.id },
        orderBy: { createdAt: "asc" },
      });
      expect(downloads.map((d) => d.summary)).toEqual([
        expect.stringMatching(/^Downloaded the database file of the backup from /),
        expect.stringMatching(/^Downloaded the manifest file/),
        expect.stringMatching(/^Downloaded the media file/),
      ]);
      expect(downloads.every((d) => d.userId === owner.userId && d.companyId === null)).toBe(true);

      await expectAppError(backups.getBackupFile(owner, "no-such-run", "database"), "NOT_FOUND");
      // A run whose recorded path points outside the backup folder serves nothing.
      const forged = await prisma.backupRun.create({
        data: {
          trigger: "MANUAL",
          status: "SUCCEEDED",
          finishedAt: new Date(),
          dbDumpPath: "../../etc/passwd",
          mediaArchivePath: "../uploads/logos/extras.png",
        },
      });
      for (const kind of ["database", "media", "manifest"] as const) {
        await expectAppError(backups.getBackupFile(owner, forged.id, kind), "NOT_FOUND");
      }
    });

    // v6.4 (G3): every backup holds every uploaded file; v6.3's "leave out the
    // uploaded files" setting is gone.
    it("always saves the uploaded files, and an empty archive when there are none", async () => {
      await backups.updateBackupConfig(owner, { includeMedia: false });
      const withMedia = await backUpNow();
      expect(withMedia.files).toEqual({ database: true, media: true, manifest: true });

      await rm(uploadDir, { recursive: true, force: true });
      const nothingUploaded = await backUpNow();
      expect(nothingUploaded.files).toEqual({ database: true, media: true, manifest: true });
      const manifest = JSON.parse(
        await readFile(path.join(await folderOf(nothingUploaded.id), "manifest.json"), "utf8"),
      ) as { files: Array<{ name: string }>; uploads: unknown[] };
      expect(manifest.files.map((f) => f.name)).toEqual(["database.dump", "media.tar.gz"]);
      expect(manifest.uploads).toEqual([]);
    });

    it("never archives the backups themselves when they sit inside the uploads folder", async () => {
      vi.stubEnv("BACKUP_DIR", path.join(uploadDir, "backups"));
      const first = await backUpNow();
      const second = await backUpNow();
      expect(second.status).toBe("SUCCEEDED");
      const folder = path.join(uploadDir, "backups", path.basename(await folderOf(second.id)));
      const { stdout } = await exec("tar", ["-tzf", path.join(folder, "media.tar.gz")]);
      const entries = stdout.trim().split("\n");
      expect(entries).toContain("./logos/extras.png");
      expect(entries.filter((e) => e.includes("backups"))).toEqual([]);
      expect(first.status).toBe("SUCCEEDED");
    });

    it("answers at once for a manual backup, which finishes in the background", async () => {
      const started = await backups.runBackup({ trigger: "MANUAL", actor: owner });
      expect(started).toMatchObject({ status: "RUNNING", finishedAt: null });
      await vi.waitFor(
        async () => expect((await backups.getBackupRun(started.id)).status).toBe("SUCCEEDED"),
        { timeout: 20_000, interval: 100 },
      );
    });
  });

  describe("one backup at a time", () => {
    it("refuses a second backup while one runs, and clears runs cut off by a restart", async () => {
      const stuck = await prisma.backupRun.create({
        data: { trigger: "MANUAL", status: "RUNNING", triggeredById: owner.userId },
      });
      await expectAppError(backUpNow(), "CONFLICT");
      // The scheduler waits quietly for its turn.
      expect(await backupTick()).toBeNull();
      expect(await prisma.backupRun.count()).toBe(1);

      // Six hours on, the run is taken as cut off by a server stop.
      await prisma.backupRun.update({ where: { id: stuck.id }, data: { startedAt: hoursAgo(7) } });
      expect((await backUpNow()).status).toBe("SUCCEEDED");
      expect(await backups.getBackupRun(stuck.id)).toMatchObject({
        status: "FAILED",
        error: "Interrupted: the server stopped during the backup.",
      });
    });

    it("records a backup as done after restoring the database from it", async () => {
      const done = await backUpNow();
      const saved = await prisma.backupRun.findUniqueOrThrow({ where: { id: done.id } });
      // The backup's own dump holds its run as still running, with no files yet.
      await prisma.backupRun.update({
        where: { id: done.id },
        data: {
          status: "RUNNING",
          finishedAt: null,
          dbDumpPath: null,
          mediaArchivePath: null,
          sizeBytes: null,
        },
      });
      // A run cut off before its files were written stays for the six-hour rule.
      const cutOff = await prisma.backupRun.create({
        data: { trigger: "MANUAL", status: "RUNNING", startedAt: hoursAgo(1) },
      });

      expect(await backups.settleFinishedRuns()).toBe(1);
      const settled = await prisma.backupRun.findUniqueOrThrow({ where: { id: done.id } });
      expect(settled).toMatchObject({
        status: "SUCCEEDED",
        dbDumpPath: saved.dbDumpPath,
        mediaArchivePath: saved.mediaArchivePath,
        sizeBytes: saved.sizeBytes,
        driveError: null,
      });
      expect(settled.finishedAt).toBeInstanceOf(Date);
      expect(await backups.getBackupRun(done.id)).toMatchObject({
        files: { database: true, media: true, manifest: true },
      });
      expect((await backups.getBackupRun(cutOff.id)).status).toBe("RUNNING");
      expect(await backups.settleFinishedRuns()).toBe(0);

      // With Google Drive connected, the run says the Drive copy is not known.
      await prisma.backupRun.update({ where: { id: done.id }, data: { status: "RUNNING" } });
      await prisma.backupConfig.update({
        where: { id: (await backups.getBackupConfig()).id },
        data: { credentialsRef: encryptSecret("refresh-1") },
      });
      expect(await backups.settleFinishedRuns()).toBe(1);
      expect((await backups.getBackupRun(done.id)).driveError).toMatch(/^Not known whether/);

      // A damaged backup folder is not taken as finished.
      await prisma.backupRun.update({ where: { id: done.id }, data: { status: "RUNNING" } });
      await writeFile(path.join(await folderOf(done.id), "database.dump"), "cut short");
      expect(await backups.settleFinishedRuns()).toBe(0);
    });

    it("lets only one of two backups started together run", async () => {
      const results = await Promise.allSettled([backUpNow(), backUpNow()]);
      expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toMatchObject({ code: "CONFLICT" });
      expect(await prisma.backupRun.count()).toBe(1);
    });
  });

  describe("failures", () => {
    it("records why a backup failed and leaves nothing half-made", async () => {
      vi.stubEnv("PG_DUMP_PATH", path.join(dir, "missing", "pg_dump"));
      const failed = await backUpNow();
      expect(failed).toMatchObject({
        status: "FAILED",
        error:
          "pg_dump was not found on the server: install the PostgreSQL client tools or set PG_DUMP_PATH.",
        files: { database: false, media: false, manifest: false },
        sizeBytes: null,
      });
      expect(failed.finishedAt).not.toBeNull();
      expect(await readdir(backupDir)).toEqual([]);
      await expectAppError(backups.getBackupFile(owner, failed.id, "database"), "CONFLICT");
      expect((await backups.getBackupOverview()).server.pgDump).toBeNull();

      // pg_dump's own error is kept, without the database password.
      vi.stubEnv("PG_DUMP_PATH", "");
      const url = new URL(process.env.DATABASE_URL!);
      url.password = "not-the-password";
      vi.stubEnv("DATABASE_URL", url.toString());
      const refused = await backUpNow();
      expect(refused.status).toBe("FAILED");
      expect(refused.error).toMatch(/password authentication failed/);
      expect(refused.error).not.toContain("not-the-password");
      expect(await readdir(backupDir)).toEqual([]);

      // A failed backup does not stop the next one.
      vi.stubEnv("DATABASE_URL", process.env.TEST_DATABASE_URL!);
      expect((await backUpNow()).status).toBe("SUCCEEDED");
      const overview = await backups.getBackupOverview();
      expect(overview.lastSuccess?.status).toBe("SUCCEEDED");
    });
  });

  describe("retention", () => {
    // v6.4 (G2): the server keeps the newest `serverKeep` backups (default 4),
    // not every backup of the last 30 days.
    it("keeps the newest backups on the server and clears failed runs", async () => {
      const failedLongAgo = await prisma.backupRun.create({
        data: {
          trigger: "SCHEDULED",
          status: "FAILED",
          startedAt: daysAgo(40),
          finishedAt: daysAgo(40),
          error: "pg_dump was not found on the server.",
        },
      });
      const made = [];
      for (let i = 0; i < 5; i++) made.push(await backUpNow());
      const [oldest, , , , latest] = made;
      expect((await readdir(backupDir)).filter((n) => !n.startsWith(".")).sort()).toEqual(
        made
          .slice(1)
          .map((r) => r.name)
          .sort(),
      );
      const removed = await backups.getBackupRun(oldest!.id);
      expect(removed.files).toEqual({ database: false, media: false, manifest: false });
      expect(removed.filesDeletedAt).not.toBeNull();
      expect(removed.status).toBe("SUCCEEDED");
      await expectAppError(backups.getBackupFile(owner, oldest!.id, "database"), "CONFLICT");
      expect((await backups.getBackupRun(failedLongAgo.id)).filesDeletedAt).not.toBeNull();
      expect((await backups.getBackupRun(latest!.id)).files.database).toBe(true);

      // The history stays, newest first, a page at a time.
      const page1 = await backups.listBackupRuns({ take: "2" });
      expect(page1.items.map((r) => r.id)).toEqual([made[4]!.id, made[3]!.id]);
      expect(page1.nextCursor).toBe(made[3]!.id);
      const all = await backups.listBackupRuns({ take: "10" });
      expect(all.items.map((r) => r.id).at(-1)).toBe(failedLongAgo.id);
    });
  });

  describe("schedule", () => {
    it("starts the scheduled backup once per scheduled time and catches up after downtime", async () => {
      const first = await backupTick();
      expect(first).toMatchObject({ trigger: "SCHEDULED", status: "SUCCEEDED", triggeredBy: null });
      expect(await backupTick()).toBeNull();
      expect(await prisma.backupRun.count()).toBe(1);
      expect(
        await prisma.auditLog.findFirst({
          where: { entityType: "BackupRun", entityId: first!.id },
        }),
      ).toMatchObject({ userId: null, summary: "Scheduled backup" });

      // The server was off for two days: the missed backup runs as soon as it is back.
      await prisma.backupRun.update({ where: { id: first!.id }, data: { startedAt: daysAgo(2) } });
      expect((await backupTick())?.trigger).toBe("SCHEDULED");
      expect(await backupTick()).toBeNull();
      expect(await prisma.backupRun.count()).toBe(2);
    });

    it("lets only one server process start it", async () => {
      const [a, b] = await Promise.all([backupTick(), backupTick()]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect(await prisma.backupRun.count()).toBe(1);
    });

    it("checks the settings, shows the next run, and can be switched off", async () => {
      await expectAppError(
        backups.updateBackupConfig(owner, { cronSchedule: "0 25 * * *" }),
        "VALIDATION",
      );
      await expect(backups.updateBackupConfig(owner, { timezone: "Mars/Olympus" })).rejects.toThrow(
        ZodError,
      );
      await expect(backups.updateBackupConfig(owner, { serverKeep: 0 })).rejects.toThrow(ZodError);

      // v6.3's "daily time" still sets every day at that time.
      const updated = await backups.updateBackupConfig(owner, {
        dailyTime: "03:30",
        serverKeep: 5,
      });
      expect(updated).toMatchObject({
        scheduleText: "Every day at 03:30",
        timezone: "Asia/Dhaka",
        serverKeep: 5,
        isEnabled: true,
      });
      const next = updated.nextRunAt!;
      expect(next.getTime()).toBeGreaterThan(Date.now());
      expect(next.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
      expect(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Dhaka",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(next),
      ).toBe("03:30");
      expect(
        await prisma.auditLog.findFirst({
          where: { action: "UPDATE", entityType: "BackupConfig" },
          orderBy: { createdAt: "desc" },
        }),
      ).toMatchObject({
        userId: owner.userId,
        summary: "Changed backup settings: schedule: Every day at 03:30, keep 5 on the server",
      });

      const off = await backups.updateBackupConfig(owner, { isEnabled: false });
      expect(off.nextRunAt).toBeNull();
      expect(await backupTick()).toBeNull();
      expect(await prisma.backupRun.count()).toBe(0);
    });
  });

  describe("Google Drive", () => {
    let google: FakeGoogle;
    let ctx: CompanyContext;

    beforeEach(async () => {
      google = await startFakeGoogle({ email: "owner@gmail.com" }, 0);
      vi.stubEnv("GOOGLE_OAUTH_BASE", google.url);
      vi.stubEnv("GOOGLE_DRIVE_BASE", google.url);
      const { company, roles } = await makeCompany("Extras");
      await addToCompany(owner.userId, company.id, roles.SUPER_ADMIN);
      ctx = await contextFor(owner.userId, company.id);
    });

    afterEach(async () => {
      await google.close();
    });

    const folders = () => [...google.files.values()].filter((f) => f.mimeType === FOLDER);
    const backupFolders = () => folders().filter((f) => f.appProperties.extas === "backup");
    const inbox = async () =>
      (
        await prisma.notificationLog.findMany({
          where: { userId: owner.userId },
          orderBy: { createdAt: "asc" },
        })
      ).map((n) => n.subject);

    const OWNER_KEY = "my own recovery sentence";
    /** The owner's steps on the Backups screen: the code on the phone, then the recovery key. */
    async function connectDrive() {
      await backups.startGoogleSignIn(owner);
      expect((await backups.checkGoogleSignIn(owner)).status).toBe("connected");
    }
    async function readyToSend() {
      await connectDrive();
      await setPin(ctx, { pin: "2468" });
      const set = await setRecoveryKey(ctx, {
        pin: "2468",
        key: OWNER_KEY,
        confirm: OWNER_KEY,
      });
      return { keyId: set.config.recoveryKey.pairId!, recoveryKey: OWNER_KEY };
    }

    it("connects Drive with a code on the owner's phone, and forgets it on disconnect", async () => {
      google.options.pendingPolls = 1;
      const code = await backups.startGoogleSignIn(owner);
      expect(code.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
      expect(code.verificationUrl).toMatch(/^https?:\/\//);
      expect((await backups.getBackupOverview()).config.googleDrive).toMatchObject({
        connected: false,
        signingIn: true,
      });
      // Until the owner says yes on the phone, the screen keeps asking.
      expect((await backups.checkGoogleSignIn(owner)).status).toBe("waiting");
      const done = await backups.checkGoogleSignIn(owner);
      expect(done.status).toBe("connected");
      expect(done.config.googleDrive).toMatchObject({
        available: true,
        connected: true,
        account: "owner@gmail.com",
        signingIn: false,
      });

      // One labelled folder for every backup, found again on the next connection.
      const [root] = folders();
      expect(folders()).toHaveLength(1);
      expect(root).toMatchObject({
        name: "Extas ERP Backups",
        appProperties: { extas: "backups" },
      });
      expect(done.config.googleDrive.folderId).toBe(root!.id);

      // The refresh token is stored sealed, and never shown.
      const config = await backups.getBackupConfig();
      expect(config.credentialsRef).toMatch(/^v1:/);
      const refresh = decryptSecret(config.credentialsRef!);
      expect(google.refreshTokens.has(refresh)).toBe(true);
      expect(JSON.stringify(await backups.getBackupOverview())).not.toContain(refresh);

      const off = await backups.disconnectGoogleDrive(owner);
      expect(off.googleDrive).toMatchObject({ connected: false, account: null, folderId: null });
      expect(google.refreshTokens.has(refresh)).toBe(false);
      google.options.pendingPolls = 0;
      await connectDrive();
      expect(folders()).toHaveLength(1);
      expect((await backups.getBackupConfig()).googleDriveFolderId).toBe(root!.id);

      // The owner says no on the phone: nothing changes.
      await backups.disconnectGoogleDrive(owner);
      google.options.deny = true;
      await backups.startGoogleSignIn(owner);
      expect((await backups.checkGoogleSignIn(owner)).status).toBe("denied");
      expect((await backups.getBackupConfig()).credentialsRef).toBeNull();

      expect(
        (
          await prisma.auditLog.findMany({
            where: { entityType: "BackupConfig" },
            orderBy: { createdAt: "asc" },
          })
        ).map((a) => a.summary),
      ).toEqual([
        "Started connecting Google Drive (a code for the owner's phone)",
        "Connected Google Drive for backups (owner@gmail.com)",
        "Disconnected Google Drive (owner@gmail.com); backups stay on the server only",
        "Started connecting Google Drive (a code for the owner's phone)",
        "Connected Google Drive for backups (owner@gmail.com)",
        "Disconnected Google Drive (owner@gmail.com); backups stay on the server only",
        "Started connecting Google Drive (a code for the owner's phone)",
      ]);
    });

    // v6.3's "shows the recovery key once" test is replaced by the owner's own
    // key (tests/integration/backups-v64.test.ts, "the owner's recovery key").

    // v6.4 (G2): the server keeps its copy (the newest few) after Google's is checked.
    it("locks each backup, sends it to Drive, checks Google's copy, and keeps the server's", async () => {
      const made = await readyToSend();
      const done = await backUpNow();
      expect(done).toMatchObject({
        status: "SUCCEEDED",
        kind: "BACKUP",
        keyId: made.keyId,
        onGoogleDrive: true,
        driveError: null,
        files: { database: true, media: true, manifest: true },
      });
      expect(done.checkedAt).not.toBeNull();
      expect(done.filesDeletedAt).toBeNull();

      const [folder] = backupFolders();
      expect(folder).toMatchObject({
        name: done.name,
        appProperties: { extas: "backup", kind: "BACKUP", checked: "yes", keyId: made.keyId },
      });
      const inside = [...google.files.values()].filter((f) => f.parents.includes(folder!.id));
      expect(inside.map((f) => f.name).sort()).toEqual([
        "backup-keys.json",
        "database.dump.locked",
        "manifest.json",
        "media.tar.gz.locked",
        "server.json.locked",
      ]);
      // Google holds only locked bytes: no company name, no dump header.
      for (const file of inside.filter((f) => f.name.endsWith(".locked"))) {
        expect(file.data!.subarray(0, 8).toString()).toBe("EXTASPK1");
        expect(file.data!.includes("PGDMP")).toBe(false);
        expect(file.data!.includes("extras.png")).toBe(false);
      }

      // The recovery key opens it again, every file checked.
      const config = await backups.getBackupConfig();
      const token = (await driveToken(config))!;
      const opened = await fetchBackup(
        token,
        { id: folder!.id, name: folder!.name },
        path.join(dir, "opened"),
        { recoveryKey: OWNER_KEY },
      );
      expect((await readFile(opened.database)).subarray(0, 5).toString()).toBe("PGDMP");
      expect(opened.server).toMatchObject({
        encryptionKey: "test-encryption-key-0123456789",
        ownerEmail: "owner@extras.test",
        appUrl: "https://erp.example.com",
      });
      const unpacked = path.join(dir, "unpacked");
      await mkdir(unpacked);
      await exec("tar", ["-xzf", opened.media!, "-C", unpacked]);
      expect(await readFile(path.join(unpacked, "logos", "extras.png"), "utf8")).toBe(
        "not really a png",
      );

      // Another key does not open it.
      await expect(
        fetchBackup(token, { id: folder!.id, name: folder!.name }, path.join(dir, "other"), {
          recoveryKey: "somebody else's key",
        }),
      ).rejects.toThrow(/not the one these backups were locked with/);

      expect((await listDriveBackups()).items).toEqual([
        expect.objectContaining({
          name: done.name,
          kind: "BACKUP",
          checked: true,
          keyId: made.keyId,
        }),
      ]);
    });

    it("keeps a backup on the server when Drive refuses it, tells the owner, and sends it again", async () => {
      await readyToSend();
      google.options.quotaFull = true;
      const refused = await backUpNow();
      expect(refused).toMatchObject({
        status: "SUCCEEDED",
        onGoogleDrive: false,
        checkedAt: null,
        files: { database: true, media: true, manifest: true },
      });
      expect(refused.driveError).toMatch(/^Saved on the server, but not in Google Drive: .*quota/);
      // No half-sent folder is left in Drive.
      expect(backupFolders()).toEqual([]);
      expect(await inbox()).toEqual(["Backup not in Google Drive"]);

      // Within the hour it goes again, by itself.
      google.options.quotaFull = false;
      expect(await sendUnsent(Date.now())).toBe(0);
      expect(await sendUnsent(Date.now() + 2 * 3_600_000)).toBe(1);
      const sent = await backups.getBackupRun(refused.id);
      expect(sent).toMatchObject({ onGoogleDrive: true, driveError: null });
      expect(sent.checkedAt).not.toBeNull();
      expect(backupFolders()).toHaveLength(1);
    });

    it("throws away a Drive copy that arrived damaged, and keeps the server's", async () => {
      await readyToSend();
      google.options.damageUploads = true;
      const damaged = await backUpNow();
      expect(damaged.onGoogleDrive).toBe(false);
      expect(damaged.driveError).toMatch(/does not match the server's/);
      expect(damaged.files.database).toBe(true);
      expect(backupFolders()).toEqual([]);
    });

    // v6.3's "keep N backups in Drive" became "keep them N days" (backups-v64.test.ts, "keeping").

    // v6.4 (G11): monthly, compared with the manifest (more in backups-v64.test.ts).
    it("restores the newest backup into a temporary database every month, checks it and drops it", async () => {
      await readyToSend();
      await makeCompany("Extras Kids");
      const backup = await backUpNow();

      const tested = await runTestRestore({ trigger: "MANUAL", actor: owner, wait: true });
      expect(tested).toMatchObject({
        kind: "TEST_RESTORE",
        status: "SUCCEEDED",
        sourceName: backup.name,
      });
      const report = tested.report as unknown as TestRestoreReport;
      expect(report).toMatchObject({
        backup: backup.name,
        ledgerBalanced: true,
        mediaFiles: 1,
        counts: { Company: { backup: 2, now: 2 }, User: { backup: 1, now: 1 } },
      });
      expect(report.tables).toBeGreaterThan(50);
      expect(report.newestMigration).toMatch(/^\d{14}_/);
      // The temporary database is gone; the live one was never touched.
      const left = await prisma.$queryRaw<Array<{ datname: string }>>`
        SELECT datname FROM pg_database WHERE datname LIKE ${`${TEST_DB_PREFIX}%`}`;
      expect(left).toEqual([]);
      expect(await prisma.company.count()).toBe(2);
      expect(await inbox()).toContain("Restore drill worked");

      // The monthly clock: once per scheduled time.
      await prisma.backupRun.deleteMany({ where: { kind: "TEST_RESTORE" } });
      const weekly = await testRestoreTick();
      expect(weekly).toMatchObject({
        kind: "TEST_RESTORE",
        trigger: "SCHEDULED",
        status: "SUCCEEDED",
      });
      expect(await testRestoreTick()).toBeNull();

      // A key typed for the drill that does not open it: the drill fails and the owner hears of it.
      const failed = await runTestRestore({
        trigger: "MANUAL",
        actor: owner,
        wait: true,
        recoveryKey: "not the owner's key",
      });
      expect(failed.status).toBe("FAILED");
      expect(failed.error).toMatch(/not the one these backups were locked with/);
      expect(await inbox()).toContain("Restore drill failed");
    });

    it("restores from the screen with the PIN and RESTORE, handing the opened backup to the server", async () => {
      await readyToSend();
      const backup = await backUpNow();
      const [folder] = backupFolders();
      const ask = (input: Record<string, unknown>) =>
        requestRestore(ctx, { folderId: folder!.id, ...input });

      // The server's helper (deploy.sh installs it) must be there.
      await expectAppError(ask({ pin: "2468", confirm: "RESTORE" }), "UNAVAILABLE");
      await writeFile(path.join(backupDir, ".restore-helper"), "");
      await expectAppError(ask({ pin: "2468", confirm: "restore" }), "VALIDATION");
      await expectAppError(ask({ confirm: "RESTORE" }), "VALIDATION");
      await expectAppError(ask({ pin: "1111", confirm: "RESTORE" }), "VALIDATION");
      await expectAppError(
        requestRestore(ctx, { folderId: "nope", pin: "2468", confirm: "RESTORE" }),
        "NOT_FOUND",
      );

      expect(await ask({ pin: "2468", confirm: "RESTORE" })).toMatchObject({ name: backup.name });
      const opened = path.join(backupDir, "restores", backup.name!);
      expect((await readdir(opened)).sort()).toEqual([
        "database.dump",
        "manifest.json",
        "media.tar.gz",
      ]);
      const manifest = JSON.parse(await readFile(path.join(opened, "manifest.json"), "utf8")) as {
        format: number;
        files: Array<{ name: string; sha256: string }>;
        tables: Record<string, number>;
      };
      expect(manifest.format).toBe(1);
      expect(manifest.tables.Company).toBe(1);
      for (const file of manifest.files) {
        expect(sha256(await readFile(path.join(opened, file.name)))).toBe(file.sha256);
      }
      const request = JSON.parse(
        await readFile(path.join(backupDir, "restore-request.json"), "utf8"),
      ) as {
        folder: string;
        requestedAt: string;
        signature: string;
      };
      expect(request.folder).toBe(`restores/${backup.name}`);
      expect(request.signature).toBe(
        createHmac("sha256", "test-encryption-key-0123456789")
          .update(`${request.folder}|${request.requestedAt}`)
          .digest("hex"),
      );
      expect((await restoreStatus()).waiting).toMatchObject({ name: backup.name });
      await expectAppError(ask({ pin: "2468", confirm: "RESTORE" }), "CONFLICT");

      // The server restored it (deploy/restore-request.sh): the ERP records it and tells the owner.
      await rm(path.join(backupDir, "restore-request.json"));
      await writeFile(
        path.join(backupDir, "restore-result.json"),
        JSON.stringify({ ok: true, name: backup.name, safetyCopy: "before-restore-x", checks: [] }),
      );
      expect(await recordRestoreResult()).toBe(true);
      expect(await recordRestoreResult()).toBe(false);
      const runs = await prisma.backupRun.findMany({ where: { kind: "RESTORE" } });
      expect(runs.map((r) => r.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
      const recorded = runs.find(
        (r) => (r.report as { safetyCopy?: string } | null)?.safetyCopy === "before-restore-x",
      );
      expect(recorded).toMatchObject({ sourceName: backup.name });
      expect(await inbox()).toContain("Restore finished");
    });

    it("sends deploy.sh's safety copies to Drive, locked, and leaves the server's copy alone", async () => {
      await readyToSend();
      const copies = path.join(dir, "safety-copies");
      const copy = path.join(copies, "before-update-2026-10-16_010000");
      await mkdir(copy, { recursive: true });
      await writeFile(path.join(copy, "database.dump"), "PGDMP the database before the update");
      vi.stubEnv("SAFETY_COPY_DIR", copies);
      // Still being written: wait.
      expect(await sendSafetyCopies(Date.now())).toBe(0);
      expect(await sendSafetyCopies(Date.now() + 5 * 60_000)).toBe(1);
      expect(await sendSafetyCopies(Date.now() + 10 * 60_000)).toBe(0);
      expect(await readFile(path.join(copy, "database.dump"), "utf8")).toContain("PGDMP");
      expect((await listDriveBackups()).items).toEqual([
        expect.objectContaining({
          name: "before-update-2026-10-16_010000",
          kind: "SAFETY_COPY",
          checked: true,
        }),
      ]);
      // The drill never takes a safety copy for a backup.
      expect((await runTestRestore({ trigger: "MANUAL", actor: owner, wait: true })).error).toMatch(
        /no checked backup/,
      );
    });
  });
});
