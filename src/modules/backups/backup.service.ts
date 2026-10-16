import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { BackupConfig, BackupKind, BackupRun, BackupTrigger } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import {
  type Actor,
  alertOwner,
  audit,
  backupRoot,
  currentKey,
  driveRoot,
  getBackupConfig,
  googleClient,
  pgDumpBinary,
  pgEnvironment,
  reasonFor,
} from "@/modules/backups/backup-core";
import { nextRun, parseCron } from "@/modules/backups/cron";
import { lockFile, newRecoveryKey, parseRecoveryKey } from "@/modules/backups/crypt";
import * as drive from "@/modules/backups/google-drive";
import {
  backupConfigSchema,
  type BackupFileKind,
  googleClientSchema,
  listBackupRunsSchema,
  recoveryKeyConfirmSchema,
  recoveryKeyMakeSchema,
} from "@/modules/backups/schemas";
import { uploadRoot } from "@/modules/files/file.service";

export {
  type Actor,
  backupRoot,
  getBackupConfig,
  pgEnvironment,
} from "@/modules/backups/backup-core";

/*
 * Daily backups of the whole platform (every company), run by the scheduler
 * (scheduler.ts) or by hand ("Back up now"):
 *   database.dump   pg_dump of the database (custom format: restore with pg_restore)
 *   media.tar.gz    the uploaded files (logos, packing lists, bill scans)
 *   server.json     this server's ENCRYPTION_KEY, so a new server can open the
 *                   sealed settings (Google, AI keys, bots) after a restore
 *   manifest.json   sizes, SHA-256 checksums and how to restore
 * Each file is locked with the owner's recovery key (crypt.ts) and sent to a
 * folder in the owner's Google Drive (drive-copies.ts); once Google's copy is
 * checked byte for byte the server's copy is deleted. Until the owner makes a
 * recovery key and connects Drive, backups stay on the server, unlocked and
 * without server.json, and the Backups screen says so. Only one backup job runs
 * at a time. Platform owner only.
 */

const exec = promisify(execFile);
const LONG_JOB = { timeout: 2 * 60 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 };
/** A run still "running" after this long was cut off (the server stopped). */
const STALE_RUN_MS = 6 * 60 * 60 * 1000;

// =============================================================================
// Settings
// =============================================================================

async function pgDumpVersion(): Promise<string | null> {
  try {
    const { stdout } = await exec(pgDumpBinary(), ["--version"], { timeout: 10_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** "02:00" from a daily cron ("0 2 * * *"); null for any other schedule. */
export function dailyTimeOf(cron: string): string | null {
  const m = cron.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!m) return null;
  return `${m[2]!.padStart(2, "0")}:${m[1]!.padStart(2, "0")}`;
}

function presentConfig(config: BackupConfig) {
  let next: Date | null = null;
  try {
    next = config.isEnabled ? nextRun(config.cronSchedule, config.timezone) : null;
  } catch {
    next = null;
  }
  const client = googleClient(config);
  const signingIn =
    config.googleDeviceRef &&
    config.googleDeviceExpiresAt &&
    config.googleDeviceExpiresAt > new Date();
  return {
    cronSchedule: config.cronSchedule,
    dailyTime: dailyTimeOf(config.cronSchedule),
    timezone: config.timezone,
    includeMedia: config.includeMedia,
    retentionDays: config.retentionDays,
    keepCount: config.keepCount,
    isEnabled: config.isEnabled,
    nextRunAt: next,
    testRestore: {
      enabled: config.testRestoreEnabled,
      schedule: config.testRestoreSchedule,
      nextRunAt: (() => {
        try {
          return config.testRestoreEnabled
            ? nextRun(config.testRestoreSchedule, config.timezone)
            : null;
        } catch {
          return null;
        }
      })(),
    },
    googleDrive: {
      /** A Google client is set (on the Backups screen, or in the server's settings). */
      available: client !== null,
      /** The client's id, to show which one is in use (the secret is never shown). */
      clientId: client?.clientId ?? null,
      setOnScreen: Boolean(config.googleClientId),
      connected: Boolean(config.credentialsRef),
      account: config.googleDriveAccount,
      folderId: config.googleDriveFolderId,
      signingIn: Boolean(signingIn),
    },
    recoveryKey: {
      made: Boolean(config.recoveryKeyRef),
      id: config.recoveryKeyId,
      madeAt: config.recoveryKeyMadeAt,
      savedAt: config.recoveryKeySavedAt,
    },
    updatedAt: config.updatedAt,
  };
}

export function presentRun(run: BackupRun & { triggeredBy?: { id: string; name: string } | null }) {
  const kept = !run.filesDeletedAt;
  return {
    id: run.id,
    kind: run.kind,
    name: run.name,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationSeconds: run.finishedAt
      ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
      : null,
    sizeBytes: run.sizeBytes === null ? null : Number(run.sizeBytes),
    /** Locked with the recovery key of this name; null: not locked. */
    keyId: run.keyId,
    /** Files still on the server, ready to download. */
    files: {
      database: kept && Boolean(run.dbDumpPath),
      media: kept && Boolean(run.mediaArchivePath),
      manifest: kept && Boolean(run.dbDumpPath),
    },
    onGoogleDrive: Boolean(run.driveFileId),
    /** Google's copy was checked byte for byte. */
    checkedAt: run.checkedAt,
    driveError: run.driveError,
    filesDeletedAt: run.filesDeletedAt,
    error: run.error,
    report: run.report,
    sourceName: run.sourceName,
    triggeredBy: run.triggeredBy ?? null,
  };
}

/**
 * The one command that restores the newest backup on a new server
 * (deploy/bootstrap.sh). It asks for a GitHub token first, for a private
 * repository; for a public one the owner just presses Enter.
 */
export function restoreCommand(config: BackupConfig): string {
  const repo = process.env.GITHUB_REPOSITORY?.trim() || "mehadih32/Extas-ERP";
  const client = googleClient(config);
  const google = client
    ? ` GOOGLE_CLIENT_ID='${client.clientId}' GOOGLE_CLIENT_SECRET='${client.clientSecret}'`
    : "";
  return (
    'read -rsp "GitHub token (press Enter if the repository is public): " T; echo; ' +
    'curl -fsSL -H "Accept: application/vnd.github.raw" ${T:+-H "Authorization: Bearer $T"} ' +
    `https://api.github.com/repos/${repo}/contents/deploy/bootstrap.sh -o bootstrap.sh && ` +
    `sudo GITHUB_REPOSITORY=${repo} GITHUB_TOKEN="$T"${google} bash bootstrap.sh`
  );
}

/** The restore command, shown on request (it holds the Google client's secret); recorded. */
export async function showRestoreCommand(actor: Actor, meta?: RequestMeta) {
  const config = await getBackupConfig();
  await audit(actor, meta, {
    action: "EXPORT",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: "Showed the one-command restore for a new server",
  });
  return { command: restoreCommand(config), googleReady: googleClient(config) !== null };
}

/** Settings, Drive connection, recovery key, the last runs and whether pg_dump is installed. */
export async function getBackupOverview() {
  const config = await getBackupConfig();
  const include = { triggeredBy: { select: { id: true, name: true } } };
  const [lastRun, lastSuccess, lastTest, unsent, pgDump] = await Promise.all([
    prisma.backupRun.findFirst({
      where: { kind: "BACKUP" },
      orderBy: { startedAt: "desc" },
      include,
    }),
    prisma.backupRun.findFirst({
      where: { kind: "BACKUP", status: "SUCCEEDED" },
      orderBy: { startedAt: "desc" },
      include,
    }),
    prisma.backupRun.findFirst({
      where: { kind: "TEST_RESTORE" },
      orderBy: { startedAt: "desc" },
      include,
    }),
    prisma.backupRun.count({
      where: {
        kind: { in: ["BACKUP", "SAFETY_COPY"] },
        status: "SUCCEEDED",
        checkedAt: null,
        filesDeletedAt: null,
      },
    }),
    pgDumpVersion(),
  ]);
  return {
    config: presentConfig(config),
    lastRun: lastRun ? presentRun(lastRun) : null,
    lastSuccess: lastSuccess ? presentRun(lastSuccess) : null,
    lastTestRestore: lastTest ? presentRun(lastTest) : null,
    /** Backups on the server not yet checked in Google Drive. */
    notSent: unsent,
    server: { backupDir: backupRoot(), pgDump },
  };
}

export async function updateBackupConfig(actor: Actor, raw: unknown, meta?: RequestMeta) {
  const { dailyTime, ...input } = backupConfigSchema.parse(raw);
  const data: Partial<BackupConfig> = { ...input };
  if (dailyTime) {
    const [h, m] = dailyTime.split(":").map(Number) as [number, number];
    data.cronSchedule = `${m} ${h} * * *`;
  }
  if (data.cronSchedule) parseCron(data.cronSchedule);
  if (data.testRestoreSchedule) parseCron(data.testRestoreSchedule);
  const config = await getBackupConfig();
  const updated = await prisma.backupConfig.update({ where: { id: config.id }, data });
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Changed backup settings: ${Object.entries({
      ...input,
      ...(dailyTime ? { dailyTime } : {}),
    })
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ")}`,
  });
  return presentConfig(updated);
}

// =============================================================================
// Google Drive connection
// =============================================================================

/** The owner's own Google Cloud client (Backups screen, "Google setup"). */
export async function setGoogleClient(actor: Actor, raw: unknown, meta?: RequestMeta) {
  const input = googleClientSchema.parse(raw);
  const config = await getBackupConfig();
  const changed = config.googleClientId !== input.clientId;
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: {
      googleClientId: input.clientId,
      googleClientSecretRef: encryptSecret(input.clientSecret),
      // Google's access belongs to the client: a new client means signing in again.
      ...(changed && config.credentialsRef
        ? { credentialsRef: null, googleDriveAccount: null, googleDriveFolderId: null }
        : {}),
      googleDeviceRef: null,
      googleDeviceExpiresAt: null,
    },
  });
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Set the Google client for backups (${input.clientId})`,
  });
  return presentConfig(updated);
}

function needClient(config: BackupConfig) {
  const client = googleClient(config);
  if (!client) {
    throw new AppError(
      "UNAVAILABLE",
      "Set the Google client first (Backups screen, Google setup): its client ID and secret.",
    );
  }
  return client;
}

/** Starts "Connect Google Drive": a code the owner enters at google.com/device on their phone. */
export async function startGoogleSignIn(actor: Actor, meta?: RequestMeta) {
  const config = await getBackupConfig();
  const client = needClient(config);
  let signIn: drive.DeviceSignIn;
  try {
    signIn = await drive.startDeviceSignIn(client);
  } catch (error) {
    if (error instanceof drive.DriveError) throw new AppError("UNAVAILABLE", error.message);
    throw error;
  }
  await prisma.backupConfig.update({
    where: { id: config.id },
    data: {
      googleDeviceRef: encryptSecret(signIn.deviceCode),
      googleDeviceExpiresAt: signIn.expiresAt,
    },
  });
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: "Started connecting Google Drive (a code for the owner's phone)",
  });
  return {
    userCode: signIn.userCode,
    verificationUrl: signIn.verificationUrl,
    expiresAt: signIn.expiresAt,
    interval: signIn.interval,
  };
}

/** Whether the owner has said yes on their phone; connects Drive when they have. */
export async function checkGoogleSignIn(actor: Actor, meta?: RequestMeta) {
  const config = await getBackupConfig();
  if (!config.googleDeviceRef || !config.googleDeviceExpiresAt) {
    return { status: config.credentialsRef ? "connected" : "none", config: presentConfig(config) };
  }
  if (config.googleDeviceExpiresAt <= new Date()) {
    const cleared = await prisma.backupConfig.update({
      where: { id: config.id },
      data: { googleDeviceRef: null, googleDeviceExpiresAt: null },
    });
    return { status: "expired", config: presentConfig(cleared) };
  }
  const client = needClient(config);
  let poll: drive.DevicePoll;
  try {
    poll = await drive.pollDeviceSignIn(client, decryptSecret(config.googleDeviceRef));
  } catch (error) {
    if (error instanceof drive.DriveError) throw new AppError("UNAVAILABLE", error.message);
    throw error;
  }
  if (poll.status === "waiting") return { status: "waiting", config: presentConfig(config) };
  if (poll.status !== "connected") {
    const cleared = await prisma.backupConfig.update({
      where: { id: config.id },
      data: { googleDeviceRef: null, googleDeviceExpiresAt: null },
    });
    return { status: poll.status, config: presentConfig(cleared) };
  }
  const account = await drive.accountEmail(poll.accessToken).catch(() => null);
  await prisma.backupConfig.update({
    where: { id: config.id },
    data: {
      credentialsRef: encryptSecret(poll.refreshToken),
      googleDriveAccount: account,
      googleDeviceRef: null,
      googleDeviceExpiresAt: null,
    },
  });
  // The backup folder: found again when this account had one, else made now.
  await driveRoot(await getBackupConfig(), poll.accessToken);
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Connected Google Drive for backups${account ? ` (${account})` : ""}`,
  });
  return { status: "connected", config: presentConfig(await getBackupConfig()) };
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
    data: {
      credentialsRef: null,
      googleDriveAccount: null,
      googleDriveFolderId: null,
      googleDeviceRef: null,
      googleDeviceExpiresAt: null,
    },
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
// The recovery key
// =============================================================================

/**
 * Makes the recovery key and shows it this once. A second key needs the PIN:
 * backups locked with the old key then open only with the old key.
 */
export async function makeRecoveryKey(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
): Promise<{ recoveryKey: string; keyId: string; replaced: boolean }> {
  const input = recoveryKeyMakeSchema.parse(raw);
  const config = await getBackupConfig();
  if (config.recoveryKeyRef) {
    const { requirePin } = await import("@/modules/ai/settings.service");
    await requirePin(ctx, input.pin, "make a new recovery key");
  }
  const recoveryKey = newRecoveryKey();
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: {
      recoveryKeyRef: encryptSecret(recoveryKey),
      recoveryKeyMadeAt: new Date(),
      recoveryKeySavedAt: null,
      recoveryKeyId: null,
    },
  });
  const id = currentKey(updated)!.id;
  await prisma.backupConfig.update({ where: { id: config.id }, data: { recoveryKeyId: id } });
  await audit({ userId: ctx.user.id }, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: config.recoveryKeyRef
      ? `Made a new backup recovery key (${id}); backups before it open only with the old key (${config.recoveryKeyId})`
      : `Made the backup recovery key (${id})`,
  });
  return { recoveryKey, keyId: id, replaced: Boolean(config.recoveryKeyRef) };
}

/** The owner proves they wrote the key down: they type its last group of four. */
export async function confirmRecoveryKey(actor: Actor, raw: unknown, meta?: RequestMeta) {
  const { lastGroup } = recoveryKeyConfirmSchema.parse(raw);
  const config = await getBackupConfig();
  if (!config.recoveryKeyRef) throw new AppError("CONFLICT", "Make the recovery key first.");
  const written = decryptSecret(config.recoveryKeyRef).split("-").at(-1);
  const typed = lastGroup.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  if (typed !== written) {
    throw new AppError("VALIDATION", "That is not the last group of your recovery key.", {
      lastGroup: ["Not the last group of the key: check your copy"],
    });
  }
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: { recoveryKeySavedAt: new Date() },
  });
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Confirmed the backup recovery key (${config.recoveryKeyId}) is written down`,
  });
  return presentConfig(updated);
}

/** Whether a typed recovery key is the one the server locks backups with (for the restore screen). */
export function isCurrentRecoveryKey(config: BackupConfig, typed: string): boolean {
  try {
    return (
      Boolean(config.recoveryKeyRef) &&
      parseRecoveryKey(typed).equals(parseRecoveryKey(decryptSecret(config.recoveryKeyRef!)))
    );
  } catch {
    return false;
  }
}

// =============================================================================
// Runs
// =============================================================================

export async function listBackupRuns(raw: unknown = {}) {
  const q = listBackupRunsSchema.parse(raw);
  const take = q.take ?? 30;
  const rows = await prisma.backupRun.findMany({
    where: q.kind ? { kind: q.kind } : {},
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
 * Takes the single backup slot (a backup, a safety copy's upload, a test
 * restore or a restore): closes runs cut off by a server stop, refuses while
 * another job runs, and records the new run as RUNNING.
 */
export async function claimRun(
  trigger: BackupTrigger,
  actor: Actor | null,
  kind: BackupKind = "BACKUP",
  name?: string,
) {
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
    if (running) {
      throw new AppError(
        "CONFLICT",
        running.kind === "BACKUP"
          ? "A backup is already running."
          : "Another backup job (a safety copy, a test restore or a restore) is running; try again in a few minutes.",
      );
    }
    return tx.backupRun.create({
      data: {
        trigger,
        kind,
        name: name ?? null,
        status: "RUNNING",
        triggeredById: actor?.userId ?? null,
      },
    });
  });
}

const MANIFEST_DUMPS = ["database.dump", "database.dump.locked"];

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
    where: { status: { in: ["QUEUED", "RUNNING"] }, kind: "BACKUP" },
  });
  if (open.length === 0) return 0;
  const root = backupRoot();
  const byStart = new Map<
    string,
    { dir: string; files: string[]; size: number; at: Date; keyId: string | null }
  >();
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      const manifestPath = path.join(dir, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        createdAt?: unknown;
        keyId?: unknown;
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
        keyId: typeof manifest.keyId === "string" ? manifest.keyId : null,
      });
    } catch {
      // No manifest, or a file is missing: not a finished backup.
    }
  }

  const config = await getBackupConfig();
  let settled = 0;
  for (const run of open) {
    const found = byStart.get(run.startedAt.toISOString());
    const dump = found?.files.find((f) => MANIFEST_DUMPS.includes(f));
    if (!found || !dump) continue;
    const media = found.files.find((f) => f.startsWith("media.tar.gz"));
    const { count } = await prisma.backupRun.updateMany({
      where: { id: run.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "SUCCEEDED",
        finishedAt: found.at,
        name: path.basename(found.dir),
        keyId: found.keyId,
        dbDumpPath: path.relative(root, path.join(found.dir, dump)),
        mediaArchivePath: media ? path.relative(root, path.join(found.dir, media)) : null,
        sizeBytes: BigInt(found.size),
        driveError: config.credentialsRef
          ? "Not known whether this backup reached Google Drive: the server stopped or was restored before the copy was recorded. It is sent again."
          : null,
      },
    });
    settled += count;
  }
  return settled;
}

/** "2026-10-02_020000" in the schedule's timezone. */
export function stampFor(at: Date, timeZone: string) {
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

/** The run's folder on the server, only if it is safely inside BACKUP_DIR. */
export function runFolder(run: Pick<BackupRun, "dbDumpPath">): string | null {
  if (!run.dbDumpPath) return null;
  const root = backupRoot();
  const folder = path.dirname(path.resolve(root, run.dbDumpPath));
  return folder.startsWith(root + path.sep) ? folder : null;
}

export type ManifestFile = {
  name: string;
  bytes: number;
  sha256: string;
  /** Google Drive's own checksum, compared after the upload. */
  md5?: string;
  /** For a locked file: the plain file inside it. */
  plain?: { name: string; bytes: number; sha256: string };
};

/**
 * Writes the manifest; when a key is given, every file is locked first and
 * only the locked files stay. Returns the files as written, with their sizes.
 */
export async function sealFolder(
  dir: string,
  plainFiles: string[],
  key: { key: Buffer; id: string } | null,
  about: Record<string, unknown>,
): Promise<{ files: ManifestFile[]; size: number; manifest: string }> {
  const files: ManifestFile[] = [];
  for (const file of plainFiles) {
    if (key) {
      const locked = `${file}.locked`;
      const facts = await lockFile(key.key, file, locked);
      await rm(file, { force: true });
      files.push({
        name: path.basename(locked),
        bytes: facts.locked.bytes,
        sha256: facts.locked.sha256,
        md5: facts.locked.md5,
        plain: { name: path.basename(file), bytes: facts.plain.bytes, sha256: facts.plain.sha256 },
      });
    } else {
      files.push({
        name: path.basename(file),
        bytes: (await stat(file)).size,
        sha256: await sha256(file),
      });
    }
  }
  const manifest = path.join(dir, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify(
      {
        app: "Extas ERP",
        format: key ? 2 : 1,
        locked: Boolean(key),
        keyId: key?.id ?? null,
        ...about,
        files,
        restore: key
          ? [
              "Locked with the owner's recovery key: restore with deploy/bootstrap.sh on a new server, or Restore on the Backups screen.",
            ]
          : [
              "Database: pg_restore --clean --if-exists --no-owner --dbname=<database> database.dump",
              "Uploaded files: tar -xzf media.tar.gz -C <UPLOAD_DIR>",
            ],
      },
      null,
      2,
    ),
  );
  const size = files.reduce((t, f) => t + f.bytes, 0) + (await stat(manifest)).size;
  return { files, size, manifest };
}

/** The platform owner's email (the first one, when there are several). */
async function platformOwnerEmail(): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { isSuperAdmin: true, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return owner?.email ?? null;
}

/** Makes the backup files for a claimed run, sends them to Drive and prunes old ones. */
async function executeRun(run: BackupRun): Promise<BackupRun> {
  const config = await getBackupConfig();
  const root = backupRoot();
  let stamp = stampFor(run.startedAt, config.timezone);
  // Each backup's name is its own (it names its folder here and in Drive).
  const taken = await prisma.backupRun.findFirst({
    where: { name: stamp, id: { not: run.id } },
    select: { id: true },
  });
  if (taken || (await exists(path.join(root, stamp)))) stamp = `${stamp}_${run.id.slice(-6)}`;
  const dir = path.join(root, stamp);
  let key: { key: Buffer; id: string } | null = null;

  try {
    key = currentKey(config);
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

    // The server's own key goes only into a locked backup, never into a plain one.
    const server = key ? path.join(dir, "server.json") : null;
    if (server) {
      await writeFile(
        server,
        JSON.stringify({
          encryptionKey: process.env.ENCRYPTION_KEY ?? null,
          appUrl: process.env.APP_URL ?? null,
          // A new server checks every screen as this owner after the restore.
          ownerEmail: await platformOwnerEmail(),
          createdAt: run.startedAt.toISOString(),
        }),
        { mode: 0o600 },
      );
    }
    const sealed = await sealFolder(
      dir,
      [db, ...(media ? [media] : []), ...(server ? [server] : [])],
      key,
      {
        createdAt: run.startedAt.toISOString(),
        timezone: config.timezone,
        kind: "BACKUP",
        trigger: run.trigger,
        companies: await prisma.company.count(),
      },
    );
    const dbName = sealed.files.find((f) => f.name.startsWith("database.dump"))!.name;
    const mediaName = sealed.files.find((f) => f.name.startsWith("media.tar.gz"))?.name;
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        name: stamp,
        keyId: key?.id ?? null,
        dbDumpPath: path.relative(root, path.join(dir, dbName)),
        mediaArchivePath: mediaName ? path.relative(root, path.join(dir, mediaName)) : null,
        sizeBytes: BigInt(sealed.size),
      },
    });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    const failed = await prisma.backupRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: reasonFor(error) },
    });
    await alertOwner(
      "Backup failed",
      `The ${stamp} backup could not be made: ${failed.error}`,
      run.id,
    );
    return failed;
  }

  // The backup is safe on the server; now Google Drive's copy.
  let finished = await prisma.backupRun.update({
    where: { id: run.id },
    data: {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      driveError: !key
        ? "Kept on the server only: make the recovery key on the Backups screen. Backups are locked with it before they go to Google Drive."
        : !config.credentialsRef
          ? "Kept on the server only: Google Drive is not connected."
          : null,
    },
  });
  if (key && config.credentialsRef) {
    const { sendToDrive } = await import("@/modules/backups/drive-copies");
    finished = await sendToDrive(finished.id);
    if (!finished.checkedAt) {
      await alertOwner(
        "Backup not in Google Drive",
        `The ${stamp} backup was made but not saved in Google Drive (${finished.driveError}). It stays on the server and is sent again within the hour.`,
        run.id,
      );
    }
  }
  try {
    const { pruneBackups } = await import("@/modules/backups/drive-copies");
    await pruneBackups(await getBackupConfig());
  } catch (error) {
    console.error("[backups] removing old backups failed", error);
  }
  return finished;
}

/**
 * Runs a backup now. Scheduled runs (no actor) and `wait: true` finish before
 * returning; a manual run from the screen returns at once while it continues.
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
    await alertOwner("Backup failed", reasonFor(error), run.id);
  });
  if (options.wait ?? options.trigger === "SCHEDULED") await job;
  return getBackupRun(run.id);
}

/** One file of a backup still on the server, for download to a PC. */
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
    throw new AppError(
      "CONFLICT",
      run.checkedAt
        ? "This backup is in Google Drive; the server's copy was deleted once Google's copy was checked."
        : "This backup's files were removed by the retention rule.",
    );
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
