import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { BackupConfig, BackupRun, BackupTrigger } from "@prisma/client";

import { decryptSecret, encryptSecret, signPayload, verifyPayload } from "@/lib/crypto";
import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { recordAudit } from "@/modules/audit/audit.service";
import { nextRun, parseCron } from "@/modules/backups/cron";
import * as drive from "@/modules/backups/google-drive";
import {
  backupConfigSchema,
  type BackupFileKind,
  googleCallbackSchema,
  listBackupRunsSchema,
} from "@/modules/backups/schemas";
import { uploadRoot } from "@/modules/files/file.service";

/*
 * Daily backups of the whole platform (every company), run by the scheduler
 * (scheduler.ts) or by hand:
 *   database.dump   pg_dump of the database (custom format: restore with pg_restore)
 *   media.tar.gz    the uploaded files (logos, packing lists, bill scans)
 *   manifest.json   sizes, SHA-256 checksums and how to restore
 * The files go to BACKUP_DIR/<date_time>/ on the server (downloadable to a PC)
 * and to a folder in the owner's Google Drive when it is connected. Backups older
 * than the retention period are deleted in both places, but the newest good one
 * always stays. Only one backup runs at a time. Platform owner only.
 */

const exec = promisify(execFile);
const LONG_JOB = { timeout: 2 * 60 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 };
const DRIVE_FOLDER_NAME = "Extras ERP Backups";
/** A run still "running" after this long was cut off (the server stopped). */
const STALE_RUN_MS = 6 * 60 * 60 * 1000;

export type Actor = { userId: string };

/**
 * Read at call time so tests (and a changed .env) can point it elsewhere. A folder
 * on the server, not part of the app: the build is told not to bundle it.
 */
export function backupRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.BACKUP_DIR || "./storage/backups");
}

const pgDumpBinary = () => process.env.PG_DUMP_PATH || "pg_dump";

/**
 * libpq settings from DATABASE_URL. They go to pg_dump as environment variables,
 * so the password never appears in the server's process list.
 */
export function pgEnvironment(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: url.searchParams.get("host") ?? (url.hostname.replace(/^\[|\]$/g, "") || "localhost"),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

async function audit(
  actor: Actor | null,
  meta: RequestMeta | undefined,
  input: {
    action: "CREATE" | "UPDATE" | "EXPORT";
    entityType: string;
    entityId?: string;
    summary: string;
  },
) {
  await recordAudit({ ...input, companyId: null, userId: actor?.userId ?? null, meta });
}

// =============================================================================
// Settings
// =============================================================================

/** The single platform-wide backup settings row (created with the defaults). */
export async function getBackupConfig(): Promise<BackupConfig> {
  const existing = await prisma.backupConfig.findFirst({ orderBy: { updatedAt: "asc" } });
  if (existing) return existing;
  return prisma.backupConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

async function pgDumpVersion(): Promise<string | null> {
  try {
    const { stdout } = await exec(pgDumpBinary(), ["--version"], { timeout: 10_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

function presentConfig(config: BackupConfig) {
  let next: Date | null = null;
  try {
    next = config.isEnabled ? nextRun(config.cronSchedule, config.timezone) : null;
  } catch {
    next = null;
  }
  return {
    cronSchedule: config.cronSchedule,
    timezone: config.timezone,
    includeMedia: config.includeMedia,
    retentionDays: config.retentionDays,
    isEnabled: config.isEnabled,
    nextRunAt: next,
    googleDrive: {
      /** The server has Google OAuth credentials (GOOGLE_DRIVE_CLIENT_ID / _SECRET). */
      available: drive.driveConfigured(),
      connected: Boolean(config.credentialsRef),
      account: config.googleDriveAccount,
      folderId: config.googleDriveFolderId,
    },
    updatedAt: config.updatedAt,
  };
}

function presentRun(run: BackupRun & { triggeredBy?: { id: string; name: string } | null }) {
  const kept = !run.filesDeletedAt;
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationSeconds: run.finishedAt
      ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
      : null,
    sizeBytes: run.sizeBytes === null ? null : Number(run.sizeBytes),
    /** Files still on the server, ready to download. */
    files: {
      database: kept && Boolean(run.dbDumpPath),
      media: kept && Boolean(run.mediaArchivePath),
      manifest: kept && Boolean(run.dbDumpPath),
    },
    onGoogleDrive: Boolean(run.driveFileId),
    driveError: run.driveError,
    filesDeletedAt: run.filesDeletedAt,
    error: run.error,
    triggeredBy: run.triggeredBy ?? null,
  };
}

/** Settings, Drive connection, the last runs and whether pg_dump is installed. */
export async function getBackupOverview() {
  const config = await getBackupConfig();
  const [lastRun, lastSuccess, pgDump] = await Promise.all([
    prisma.backupRun.findFirst({
      orderBy: { startedAt: "desc" },
      include: { triggeredBy: { select: { id: true, name: true } } },
    }),
    prisma.backupRun.findFirst({
      where: { status: "SUCCEEDED" },
      orderBy: { startedAt: "desc" },
      include: { triggeredBy: { select: { id: true, name: true } } },
    }),
    pgDumpVersion(),
  ]);
  return {
    config: presentConfig(config),
    lastRun: lastRun ? presentRun(lastRun) : null,
    lastSuccess: lastSuccess ? presentRun(lastSuccess) : null,
    server: { backupDir: backupRoot(), pgDump },
  };
}

export async function updateBackupConfig(actor: Actor, raw: unknown, meta?: RequestMeta) {
  const input = backupConfigSchema.parse(raw);
  if (input.cronSchedule) parseCron(input.cronSchedule);
  const config = await getBackupConfig();
  const updated = await prisma.backupConfig.update({ where: { id: config.id }, data: input });
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Changed backup settings: ${Object.entries(input)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ")}`,
  });
  return presentConfig(updated);
}

// =============================================================================
// Google Drive connection
// =============================================================================

/** Google's consent page for the owner; the signed state ties the answer to them. */
export function googleConnectUrl(actor: Actor) {
  const state = signPayload({ u: actor.userId, p: "drive-backup" }, 15 * 60);
  return { url: drive.authorizationUrl(state), redirectUri: drive.redirectUri() };
}

/** Google sends the owner back here with a one-time code. */
export async function completeGoogleConnect(actor: Actor, raw: unknown, meta?: RequestMeta) {
  const input = googleCallbackSchema.parse(raw);
  const state = verifyPayload<{ u: string; p: string }>(input.state);
  if (!state || state.p !== "drive-backup" || state.u !== actor.userId) {
    throw new AppError(
      "FORBIDDEN",
      "This Google Drive link has expired or is not yours; start again.",
    );
  }
  if (input.error || !input.code) {
    throw new AppError("VALIDATION", "Google Drive access was not granted.");
  }
  let connected: { refreshToken: string; account: string | null; folderId: string };
  try {
    const tokens = await drive.exchangeCode(input.code);
    const account = await drive.accountEmail(tokens.accessToken);
    const folder = await drive.createFolder(tokens.accessToken, DRIVE_FOLDER_NAME);
    connected = { refreshToken: tokens.refreshToken, account, folderId: folder.id };
  } catch (error) {
    if (error instanceof drive.DriveError) throw new AppError("UNAVAILABLE", error.message);
    throw error;
  }
  const config = await getBackupConfig();
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: {
      credentialsRef: encryptSecret(connected.refreshToken),
      googleDriveAccount: connected.account,
      googleDriveFolderId: connected.folderId,
    },
  });
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Connected Google Drive for backups${connected.account ? ` (${connected.account})` : ""}`,
  });
  return presentConfig(updated);
}

export async function disconnectGoogleDrive(actor: Actor, meta?: RequestMeta) {
  const config = await getBackupConfig();
  if (config.credentialsRef) {
    try {
      await drive.revoke(decryptSecret(config.credentialsRef));
    } catch {
      // A token that cannot be unlocked any more is simply forgotten.
    }
  }
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: { credentialsRef: null, googleDriveAccount: null, googleDriveFolderId: null },
  });
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Disconnected Google Drive${config.googleDriveAccount ? ` (${config.googleDriveAccount})` : ""}; backups stay on the server only`,
  });
  return presentConfig(updated);
}

// =============================================================================
// Runs
// =============================================================================

export async function listBackupRuns(raw: unknown = {}) {
  const q = listBackupRunsSchema.parse(raw);
  const take = q.take ?? 30;
  const rows = await prisma.backupRun.findMany({
    include: { triggeredBy: { select: { id: true, name: true } } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items: items.map(presentRun), nextCursor: hasMore ? items.at(-1)?.id : undefined };
}

export async function getBackupRun(runId: string) {
  const run = await prisma.backupRun.findUnique({
    where: { id: runId },
    include: { triggeredBy: { select: { id: true, name: true } } },
  });
  if (!run) throw new AppError("NOT_FOUND", "Backup not found.");
  return presentRun(run);
}

/**
 * Takes the single backup slot: closes runs cut off by a server stop, refuses
 * while another backup runs, and records the new run as RUNNING.
 */
async function claimRun(trigger: BackupTrigger, actor: Actor | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('extras-erp:backup'))`;
    await tx.backupRun.updateMany({
      where: {
        status: { in: ["QUEUED", "RUNNING"] },
        startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) },
      },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: "Interrupted: the server stopped during the backup.",
      },
    });
    const running = await tx.backupRun.findFirst({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (running) throw new AppError("CONFLICT", "A backup is already running.");
    return tx.backupRun.create({
      data: { trigger, status: "RUNNING", triggeredById: actor?.userId ?? null },
    });
  });
}

/**
 * Finishes the record of runs still marked QUEUED or RUNNING whose files were all
 * written. A database restored from a backup holds that backup's own run as
 * RUNNING (the dump is taken while it runs), and a server stopped during the
 * Google Drive copy leaves its run that way too. The run's folder is the one
 * whose manifest.json has the run's start time. Called when the server starts;
 * a run without its files is left to the six-hour rule in claimRun.
 */
export async function settleFinishedRuns(): Promise<number> {
  const open = await prisma.backupRun.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (open.length === 0) return 0;
  const root = backupRoot();
  const byStart = new Map<string, { dir: string; files: string[]; size: number; at: Date }>();
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      const manifestPath = path.join(dir, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        createdAt?: unknown;
        files?: { name?: unknown; bytes?: unknown }[];
      };
      const files = manifest.files ?? [];
      if (typeof manifest.createdAt !== "string" || files.length === 0) continue;
      const written = await stat(manifestPath);
      let size = written.size;
      for (const file of files) {
        if (typeof file.name !== "string" || path.basename(file.name) !== file.name) {
          throw new Error("unexpected file name");
        }
        const bytes = (await stat(path.join(dir, file.name))).size;
        if (bytes !== file.bytes) throw new Error("incomplete file");
        size += bytes;
      }
      byStart.set(manifest.createdAt, {
        dir,
        files: files.map((f) => f.name as string),
        size,
        at: written.mtime,
      });
    } catch {
      // No manifest, or a file is missing: not a finished backup.
    }
  }

  const config = await getBackupConfig();
  let settled = 0;
  for (const run of open) {
    const found = byStart.get(run.startedAt.toISOString());
    if (!found || !found.files.includes("database.dump")) continue;
    const { count } = await prisma.backupRun.updateMany({
      where: { id: run.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "SUCCEEDED",
        finishedAt: found.at,
        dbDumpPath: path.relative(root, path.join(found.dir, "database.dump")),
        mediaArchivePath: found.files.includes("media.tar.gz")
          ? path.relative(root, path.join(found.dir, "media.tar.gz"))
          : null,
        sizeBytes: BigInt(found.size),
        driveError: config.credentialsRef
          ? "Not known whether this backup reached Google Drive: the server stopped or was restored before the copy was recorded."
          : null,
      },
    });
    settled += count;
  }
  return settled;
}

/** "2026-10-02_020000" in the schedule's timezone. */
function stampFor(at: Date, timeZone: string) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(at)
    .replace(/:/g, "");
  return `${localDay(at, timeZone)}_${time}`;
}

async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function hasFiles(dir: string) {
  try {
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** A short, safe reason for a failed step (never the database password). */
function reasonFor(error: unknown): string {
  const e = error as NodeJS.ErrnoException & { stderr?: string; path?: string };
  if (e?.code === "ENOENT" && (e.path === pgDumpBinary() || /pg_dump/.test(String(e.message)))) {
    return "pg_dump was not found on the server: install the PostgreSQL client tools or set PG_DUMP_PATH.";
  }
  const detail = (
    e?.stderr?.trim() || (error instanceof Error ? error.message : String(error))
  ).replace(/postgres(ql)?:\/\/[^\s]+/g, "postgresql://***");
  return detail.slice(0, 1000);
}

/** The run's folder on the server, only if it is safely inside BACKUP_DIR. */
function runFolder(run: Pick<BackupRun, "dbDumpPath">): string | null {
  if (!run.dbDumpPath) return null;
  const root = backupRoot();
  const folder = path.dirname(path.resolve(root, run.dbDumpPath));
  return folder.startsWith(root + path.sep) ? folder : null;
}

/** Copies the run's files to a new folder inside the Drive backup folder. */
async function copyToDrive(config: BackupConfig, stamp: string, files: string[]) {
  const token = await drive.accessToken(decryptSecret(config.credentialsRef!));
  let rootId = config.googleDriveFolderId;
  if (!rootId || !(await drive.folderExists(token, rootId))) {
    rootId = (await drive.createFolder(token, DRIVE_FOLDER_NAME)).id;
    await prisma.backupConfig.update({
      where: { id: config.id },
      data: { googleDriveFolderId: rootId },
    });
  }
  const folder = await drive.createFolder(token, stamp, rootId);
  for (const file of files) {
    await drive.uploadFile(
      token,
      file,
      folder.id,
      file.endsWith(".json") ? "application/json" : "application/octet-stream",
    );
  }
  return { token, rootId, folderId: folder.id };
}

/** Deletes local copies older than the retention period, keeping the newest good backup. */
async function pruneLocal(config: BackupConfig) {
  const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000);
  const newest = await prisma.backupRun.findFirst({
    where: { status: "SUCCEEDED", filesDeletedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  const old = await prisma.backupRun.findMany({
    where: {
      startedAt: { lt: cutoff },
      filesDeletedAt: null,
      status: { in: ["SUCCEEDED", "FAILED"] },
      ...(newest ? { id: { not: newest.id } } : {}),
    },
  });
  for (const run of old) {
    const folder = runFolder(run);
    if (folder) await rm(folder, { recursive: true, force: true });
    await prisma.backupRun.update({ where: { id: run.id }, data: { filesDeletedAt: new Date() } });
  }
  return old.length;
}

/** Makes the backup files for a claimed run, copies them to Drive and prunes old ones. */
async function executeRun(run: BackupRun): Promise<BackupRun> {
  const config = await getBackupConfig();
  const root = backupRoot();
  let stamp = stampFor(run.startedAt, config.timezone);
  if (await exists(path.join(root, stamp))) stamp = `${stamp}_${run.id.slice(-6)}`;
  const dir = path.join(root, stamp);

  let files: { db: string; media: string | null; manifest: string };
  try {
    await mkdir(dir, { recursive: true });
    const db = path.join(dir, "database.dump");
    await exec(pgDumpBinary(), ["--format=custom", "--no-owner", "--no-privileges", "--file", db], {
      ...LONG_JOB,
      env: { ...process.env, ...pgEnvironment(process.env.DATABASE_URL ?? "") },
    });

    let media: string | null = null;
    const uploads = uploadRoot();
    if (config.includeMedia && (await hasFiles(uploads))) {
      media = path.join(dir, "media.tar.gz");
      const args = ["-czf", media, "-C", uploads];
      // Never archive the backups themselves when BACKUP_DIR sits inside UPLOAD_DIR.
      const inside = path.relative(uploads, root);
      if (inside && !inside.startsWith("..") && !path.isAbsolute(inside)) {
        args.push(`--exclude=./${inside}`);
      }
      args.push(".");
      await exec("tar", args, LONG_JOB);
    }

    const described = [];
    for (const file of [db, ...(media ? [media] : [])]) {
      described.push({
        name: path.basename(file),
        bytes: (await stat(file)).size,
        sha256: await sha256(file),
      });
    }
    const manifest = path.join(dir, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify(
        {
          app: "Extras ERP",
          format: 1,
          createdAt: run.startedAt.toISOString(),
          timezone: config.timezone,
          trigger: run.trigger,
          companies: await prisma.company.count(),
          files: described,
          restore: [
            "Database: pg_restore --clean --if-exists --no-owner --dbname=<database> database.dump",
            "Uploaded files: tar -xzf media.tar.gz -C <UPLOAD_DIR>",
          ],
        },
        null,
        2,
      ),
    );
    const size = described.reduce((t, f) => t + f.bytes, 0) + (await stat(manifest)).size;
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        dbDumpPath: path.relative(root, db),
        mediaArchivePath: media ? path.relative(root, media) : null,
        sizeBytes: BigInt(size),
      },
    });
    files = { db, media, manifest };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    return prisma.backupRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: reasonFor(error) },
    });
  }

  // The backup is safe on the server; Google Drive is the off-site copy.
  let driveFileId: string | null = null;
  let driveError: string | null = null;
  if (config.credentialsRef) {
    try {
      const copied = await copyToDrive(config, stamp, [
        files.manifest,
        files.db,
        ...(files.media ? [files.media] : []),
      ]);
      driveFileId = copied.folderId;
      // Old copies on Drive go only after this one is safely there.
      const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000);
      for (const old of await drive.listOldFolders(copied.token, copied.rootId, cutoff)) {
        if (old.id !== copied.folderId) await drive.deleteFile(copied.token, old.id);
      }
    } catch (error) {
      const reconnect = error instanceof drive.DriveError && error.reconnect;
      driveError = reconnect
        ? "Google Drive access was revoked or expired: connect Google Drive again. The backup is saved on the server."
        : `Saved on the server, but not on Google Drive: ${reasonFor(error)}`;
    }
  }
  const finished = await prisma.backupRun.update({
    where: { id: run.id },
    data: { status: "SUCCEEDED", finishedAt: new Date(), driveFileId, driveError },
  });
  try {
    await pruneLocal(config);
  } catch (error) {
    console.error("[backups] removing old backups failed", error);
  }
  return finished;
}

/**
 * Runs a backup now. Scheduled runs (no actor) and `wait: true` finish before
 * returning; a manual run from the API returns at once while it continues.
 */
export async function runBackup(
  options: { trigger: BackupTrigger; actor?: Actor | null; wait?: boolean },
  meta?: RequestMeta,
) {
  const actor = options.actor ?? null;
  const run = await claimRun(options.trigger, actor);
  await audit(actor, meta, {
    action: "CREATE",
    entityType: "BackupRun",
    entityId: run.id,
    summary: `${options.trigger === "MANUAL" ? "Started" : "Scheduled"} backup`,
  });
  // Never rejects: a manual run is not awaited, and an unhandled rejection would stop the server.
  const job = executeRun(run).catch(async (error: unknown) => {
    console.error("[backups] backup failed", error);
    await prisma.backupRun
      .update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date(), error: reasonFor(error) },
      })
      .catch((inner: unknown) => console.error("[backups] could not record the failure", inner));
  });
  if (options.wait ?? options.trigger === "SCHEDULED") await job;
  return getBackupRun(run.id);
}

/** One file of a backup, for download to a PC. */
export async function getBackupFile(
  actor: Actor,
  runId: string,
  kind: BackupFileKind,
  meta?: RequestMeta,
) {
  const run = await prisma.backupRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError("NOT_FOUND", "Backup not found.");
  if (run.status !== "SUCCEEDED") throw new AppError("CONFLICT", "This backup did not finish.");
  if (run.filesDeletedAt) {
    throw new AppError("CONFLICT", "This backup's files were removed by the retention rule.");
  }
  const folder = runFolder(run);
  const relative =
    kind === "database" ? run.dbDumpPath : kind === "media" ? run.mediaArchivePath : null;
  const full =
    kind === "manifest"
      ? folder && path.join(folder, "manifest.json")
      : relative && path.resolve(backupRoot(), relative);
  if (!full || !full.startsWith(backupRoot() + path.sep)) {
    throw new AppError("NOT_FOUND", `This backup has no ${kind} file.`);
  }
  const info = await stat(full).catch(() => null);
  if (!info) throw new AppError("NOT_FOUND", "The file is missing on the server.");
  await audit(actor, meta, {
    action: "EXPORT",
    entityType: "BackupRun",
    entityId: run.id,
    summary: `Downloaded the ${kind} file of the backup from ${run.startedAt.toISOString()}`,
  });
  const name = `extras-erp-${path.basename(folder ?? run.id)}-${path.basename(full)}`;
  return {
    path: full,
    fileName: name,
    size: info.size,
    mimeType: kind === "manifest" ? "application/json" : "application/octet-stream",
  };
}
