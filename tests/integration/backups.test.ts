import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { decryptSecret, encryptSecret, signPayload } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as backups from "@/modules/backups/backup.service";
import { backupTick } from "@/modules/backups/scheduler";

import { makeCompany, makeUser, resetDb } from "./helpers";

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

type GoogleCall = { method: string; url: URL; headers: Record<string, string>; body: unknown };

/**
 * A stand-in for Google's sign-in and Drive APIs (fetch is replaced); returns the
 * requests made, in order.
 */
function fakeGoogle(
  opts: {
    tokenError?: string;
    noRefreshToken?: boolean;
    rootGone?: boolean;
    quotaFull?: boolean;
    oldFolders?: string[];
  } = {},
) {
  const calls: GoogleCall[] = [];
  let folders = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      const headers = (init.headers ?? {}) as Record<string, string>;
      const body =
        init.body instanceof URLSearchParams
          ? Object.fromEntries(init.body)
          : typeof init.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : init.body;
      calls.push({ method, url, headers, body });
      const name = (body as { name?: string } | undefined)?.name;

      if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
        if (opts.tokenError) return Response.json({ error: opts.tokenError }, { status: 400 });
        return Response.json({
          access_token: "access-1",
          ...(opts.noRefreshToken ? {} : { refresh_token: "refresh-new" }),
        });
      }
      if (url.host === "oauth2.googleapis.com" && url.pathname === "/revoke") {
        return new Response(null, { status: 200 });
      }
      if (url.host === "upload.example") return Response.json({ id: `file${url.pathname}` });
      if (url.pathname === "/drive/v3/about") {
        return Response.json({ user: { emailAddress: "owner@gmail.com" } });
      }
      if (url.pathname === "/upload/drive/v3/files") {
        if (opts.quotaFull) {
          return Response.json(
            { error: { message: "The user's Drive storage quota has been exceeded." } },
            { status: 403 },
          );
        }
        return new Response(null, { headers: { location: `https://upload.example/${name}` } });
      }
      if (url.pathname === "/drive/v3/files" && method === "POST") {
        folders += 1;
        return Response.json({ id: `folder-${folders}`, name });
      }
      if (url.pathname === "/drive/v3/files") {
        return Response.json({
          files: (opts.oldFolders ?? []).map((id) => ({
            id,
            name: id,
            createdTime: "2026-01-01T00:00:00.000Z",
          })),
        });
      }
      const fileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1];
      if (fileId && method === "DELETE") return new Response(null, { status: 204 });
      if (fileId) {
        return opts.rootGone
          ? Response.json({ error: { message: "File not found." } }, { status: 404 })
          : Response.json({ id: fileId, trashed: false });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }),
  );
  return calls;
}

const describeCall = (c: GoogleCall) => `${c.method} ${c.url.host}${c.url.pathname}`;

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
        onGoogleDrive: false,
        driveError: null,
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
        app: "Extras ERP",
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
        cronSchedule: "0 2 * * *",
        timezone: "Asia/Dhaka",
        includeMedia: true,
        retentionDays: 30,
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

    it("leaves out the uploaded files when asked, or when there are none", async () => {
      await backups.updateBackupConfig(owner, { includeMedia: false });
      const withoutMedia = await backUpNow();
      expect(withoutMedia.files).toEqual({ database: true, media: false, manifest: true });
      await expectAppError(backups.getBackupFile(owner, withoutMedia.id, "media"), "NOT_FOUND");

      await backups.updateBackupConfig(owner, { includeMedia: true });
      await rm(uploadDir, { recursive: true, force: true });
      const nothingUploaded = await backUpNow();
      expect(nothingUploaded.files).toEqual({ database: true, media: false, manifest: true });
      const manifest = JSON.parse(
        await readFile(path.join(await folderOf(nothingUploaded.id), "manifest.json"), "utf8"),
      ) as { files: Array<{ name: string }> };
      expect(manifest.files.map((f) => f.name)).toEqual(["database.dump"]);
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
    it("deletes backups past the retention period from the server", async () => {
      const oldest = await backUpNow();
      const oldestFolder = await folderOf(oldest.id);
      await prisma.backupRun.update({ where: { id: oldest.id }, data: { startedAt: daysAgo(31) } });
      const failedLongAgo = await prisma.backupRun.create({
        data: {
          trigger: "SCHEDULED",
          status: "FAILED",
          startedAt: daysAgo(40),
          finishedAt: daysAgo(40),
          error: "pg_dump was not found on the server.",
        },
      });
      const recent = await backUpNow();
      await prisma.backupRun.update({ where: { id: recent.id }, data: { startedAt: daysAgo(29) } });
      const recentFolder = await folderOf(recent.id);
      // Each finished backup clears what is past the 30 days.
      const latest = await backUpNow();
      const latestFolder = await folderOf(latest.id);

      expect((await readdir(backupDir)).sort()).toEqual(
        [path.basename(recentFolder), path.basename(latestFolder)].sort(),
      );
      expect(oldestFolder).not.toBe(recentFolder);
      const removed = await backups.getBackupRun(oldest.id);
      expect(removed.files).toEqual({ database: false, media: false, manifest: false });
      expect(removed.filesDeletedAt).not.toBeNull();
      expect(removed.status).toBe("SUCCEEDED");
      await expectAppError(backups.getBackupFile(owner, oldest.id, "database"), "CONFLICT");
      expect((await backups.getBackupRun(failedLongAgo.id)).filesDeletedAt).not.toBeNull();
      expect((await backups.getBackupRun(recent.id)).files.database).toBe(true);

      // The history stays, newest first, a page at a time.
      const page1 = await backups.listBackupRuns({ take: "2" });
      expect(page1.items.map((r) => r.id)).toEqual([latest.id, recent.id]);
      expect(page1.nextCursor).toBe(recent.id);
      const page2 = await backups.listBackupRuns({ take: "2", cursor: page1.nextCursor });
      expect(page2.items.map((r) => r.id)).toEqual([oldest.id, failedLongAgo.id]);
      expect(page2.nextCursor).toBeUndefined();
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
      await expect(backups.updateBackupConfig(owner, { retentionDays: 0 })).rejects.toThrow(
        ZodError,
      );

      const updated = await backups.updateBackupConfig(owner, {
        cronSchedule: "30 3 * * *",
        retentionDays: 14,
      });
      expect(updated).toMatchObject({
        cronSchedule: "30 3 * * *",
        timezone: "Asia/Dhaka",
        retentionDays: 14,
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
        summary: expect.stringContaining("cronSchedule=30 3 * * *"),
      });

      const off = await backups.updateBackupConfig(owner, { isEnabled: false });
      expect(off.nextRunAt).toBeNull();
      expect(await backupTick()).toBeNull();
      expect(await prisma.backupRun.count()).toBe(0);
    });
  });

  describe("Google Drive", () => {
    /** As if the owner had connected Drive and the app had made its folder. */
    async function connected(folderId: string) {
      const config = await backups.getBackupConfig();
      await prisma.backupConfig.update({
        where: { id: config.id },
        data: {
          credentialsRef: encryptSecret("refresh-1"),
          googleDriveAccount: "owner@gmail.com",
          googleDriveFolderId: folderId,
        },
      });
    }

    it("connects the owner's account and forgets it on disconnect", async () => {
      const { url, redirectUri } = backups.googleConnectUrl(owner);
      expect(redirectUri).toBe("https://erp.example.com/api/backups/google/callback");
      const state = new URL(url).searchParams.get("state")!;
      const calls = fakeGoogle();

      // The answer only counts for the owner who asked, while the link is fresh.
      const someone = await makeUser("someone@extras.test", { isSuperAdmin: true });
      await expectAppError(
        backups.completeGoogleConnect({ userId: someone.id }, { state, code: "code-1" }),
        "FORBIDDEN",
      );
      const expired = signPayload({ u: owner.userId, p: "drive-backup" }, -60);
      await expectAppError(
        backups.completeGoogleConnect(owner, { state: expired, code: "code-1" }),
        "FORBIDDEN",
      );
      await expectAppError(
        backups.completeGoogleConnect(owner, { state, error: "access_denied" }),
        "VALIDATION",
      );
      expect(calls).toEqual([]);

      // Google adds its own parameters to the return address.
      const result = await backups.completeGoogleConnect(owner, {
        state,
        code: "code-1",
        scope: "https://www.googleapis.com/auth/drive.file",
        authuser: "0",
      });
      expect(result.googleDrive).toEqual({
        available: true,
        connected: true,
        account: "owner@gmail.com",
        folderId: "folder-1",
      });
      expect(calls.map(describeCall)).toEqual([
        "POST oauth2.googleapis.com/token",
        "GET www.googleapis.com/drive/v3/about",
        "POST www.googleapis.com/drive/v3/files",
      ]);
      expect(calls[0]!.body).toMatchObject({
        code: "code-1",
        grant_type: "authorization_code",
        client_id: "client-123.apps.googleusercontent.com",
        redirect_uri: "https://erp.example.com/api/backups/google/callback",
      });
      expect(calls[2]!.body).toEqual({ name: "Extras ERP Backups", mimeType: FOLDER });

      // The refresh token is stored sealed, and never shown.
      const config = await backups.getBackupConfig();
      expect(config.credentialsRef).toMatch(/^v1:/);
      expect(config.credentialsRef).not.toContain("refresh-new");
      expect(decryptSecret(config.credentialsRef!)).toBe("refresh-new");
      expect(JSON.stringify(await backups.getBackupOverview())).not.toContain(
        config.credentialsRef!,
      );

      const before = calls.length;
      const disconnected = await backups.disconnectGoogleDrive(owner);
      expect(disconnected.googleDrive).toEqual({
        available: true,
        connected: false,
        account: null,
        folderId: null,
      });
      expect(calls.slice(before).map(describeCall)).toEqual(["POST oauth2.googleapis.com/revoke"]);
      expect(calls.at(-1)!.url.searchParams.get("token")).toBe("refresh-new");
      expect(
        (
          await prisma.auditLog.findMany({
            where: { entityType: "BackupConfig" },
            orderBy: { createdAt: "asc" },
          })
        ).map((a) => a.summary),
      ).toEqual([
        "Connected Google Drive for backups (owner@gmail.com)",
        "Disconnected Google Drive (owner@gmail.com); backups stay on the server only",
      ]);

      // Without a refresh token the connection would not last: refused.
      fakeGoogle({ noRefreshToken: true });
      await expectAppError(
        backups.completeGoogleConnect(owner, { state, code: "code-2" }),
        "UNAVAILABLE",
      );
      expect((await backups.getBackupConfig()).credentialsRef).toBeNull();
    });

    it("copies each backup to a dated folder in Drive and clears old copies there", async () => {
      await connected("root-1");
      const calls = fakeGoogle({ oldFolders: ["old-1", "folder-1"] });
      const done = await backUpNow();
      expect(done).toMatchObject({ status: "SUCCEEDED", onGoogleDrive: true, driveError: null });
      const stamp = path.basename(await folderOf(done.id));

      expect(calls.map(describeCall)).toEqual([
        "POST oauth2.googleapis.com/token",
        "GET www.googleapis.com/drive/v3/files/root-1",
        "POST www.googleapis.com/drive/v3/files",
        "POST www.googleapis.com/upload/drive/v3/files",
        "PUT upload.example/manifest.json",
        "POST www.googleapis.com/upload/drive/v3/files",
        "PUT upload.example/database.dump",
        "POST www.googleapis.com/upload/drive/v3/files",
        "PUT upload.example/media.tar.gz",
        "GET www.googleapis.com/drive/v3/files",
        "DELETE www.googleapis.com/drive/v3/files/old-1",
      ]);
      expect(calls[0]!.body).toMatchObject({
        grant_type: "refresh_token",
        refresh_token: "refresh-1",
      });
      expect(calls[2]!.body).toEqual({ name: stamp, mimeType: FOLDER, parents: ["root-1"] });
      expect(
        calls.filter((c) => c.url.pathname === "/upload/drive/v3/files").map((c) => c.body),
      ).toEqual([
        { name: "manifest.json", parents: ["folder-1"] },
        { name: "database.dump", parents: ["folder-1"] },
        { name: "media.tar.gz", parents: ["folder-1"] },
      ]);
      expect(
        calls
          .filter((c) => c.url.host === "www.googleapis.com")
          .every((c) => c.headers.Authorization === "Bearer access-1"),
      ).toBe(true);
      // Every byte of the dump went up.
      const dump = await readFile(path.join(backupDir, stamp, "database.dump"));
      const put = calls.find((c) => c.url.href === "https://upload.example/database.dump")!;
      expect(put.headers["Content-Range"]).toBe(`bytes 0-${dump.length - 1}/${dump.length}`);
      expect(sha256(Buffer.from(put.body as Uint8Array))).toBe(sha256(dump));
      const listing = calls.find(
        (c) => c.method === "GET" && c.url.pathname === "/drive/v3/files",
      )!;
      expect(listing.url.searchParams.get("q")).toContain("'root-1' in parents");

      const saved = await prisma.backupRun.findUniqueOrThrow({ where: { id: done.id } });
      expect(saved.driveFileId).toBe("folder-1");
    });

    it("makes the backup folder again when it was deleted from Drive", async () => {
      await connected("root-1");
      const calls = fakeGoogle({ rootGone: true });
      const done = await backUpNow();
      expect(done.onGoogleDrive).toBe(true);
      const stamp = path.basename(await folderOf(done.id));
      expect(
        calls
          .filter((c) => c.method === "POST" && c.url.pathname === "/drive/v3/files")
          .map((c) => c.body),
      ).toEqual([
        { name: "Extras ERP Backups", mimeType: FOLDER },
        { name: stamp, mimeType: FOLDER, parents: ["folder-1"] },
      ]);
      expect((await backups.getBackupOverview()).config.googleDrive.folderId).toBe("folder-1");
    });

    it("keeps the backup on the server when the Drive copy fails, and says why", async () => {
      await connected("root-1");
      fakeGoogle({ tokenError: "invalid_grant" });
      const revoked = await backUpNow();
      expect(revoked).toMatchObject({
        status: "SUCCEEDED",
        onGoogleDrive: false,
        driveError:
          "Google Drive access was revoked or expired: connect Google Drive again. The backup is saved on the server.",
        files: { database: true, media: true, manifest: true },
      });

      fakeGoogle({ quotaFull: true });
      const full = await backUpNow();
      expect(full.driveError).toBe(
        "Saved on the server, but not on Google Drive: Uploading manifest.json failed: The user's Drive storage quota has been exceeded. (HTTP 403)",
      );

      // The server's ENCRYPTION_KEY changed: the stored connection cannot be opened.
      vi.stubEnv("ENCRYPTION_KEY", "a-different-key-0123456789");
      const rekeyed = await backUpNow();
      expect(rekeyed.status).toBe("SUCCEEDED");
      expect(rekeyed.driveError).toMatch(/could not be unlocked/);
      expect(await readdir(backupDir)).toHaveLength(3);
    });
  });
});
