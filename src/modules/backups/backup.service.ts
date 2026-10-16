import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { BackupConfig, BackupKind, BackupRun, BackupTrigger, Prisma } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import {
  type Actor,
  audit,
  backupLock,
  type BackupLock,
  backupRoot,
  driveRoot,
  getBackupConfig,
  googleClient,
  guideFiles,
  hostRoot,
  type HostVersion,
  hostVersion,
  pgDumpBinary,
  reasonFor,
} from "@/modules/backups/backup-core";
import { contentsOf, dumpWithCounts, listFiles, packFiles } from "@/modules/backups/contents";
import { parseCron } from "@/modules/backups/cron";
import { lockedForPair, lockFile } from "@/modules/backups/crypt";
import * as drive from "@/modules/backups/google-drive";
import {
  DEFAULT_SCHEDULE,
  describeSchedule,
  nextDrillAt,
  nextRunAt,
  scheduleColumns,
  scheduleFromCron,
  scheduleOf,
} from "@/modules/backups/schedule";
import {
  backupConfigSchema,
  type BackupFileKind,
  googleClientSchema,
  listBackupRunsSchema,
} from "@/modules/backups/schemas";
import { uploadRoot } from "@/modules/files/file.service";

export {
  type Actor,
  backupRoot,
  getBackupConfig,
  pgEnvironment,
} from "@/modules/backups/backup-core";

/*
 * Backups of the whole platform (every company), run on the owner's schedule
 * (scheduler.ts, schedule.ts) or by hand ("Back up now"). Each one is complete,
 * so a new server needs nothing else (G3):
 *   database.dump     pg_dump of the database (custom format)
 *   media.tar.gz      every uploaded and generated file (UPLOAD_DIR)
 *   code.bundle       the code at the running version (a git bundle, made by
 *                     deploy.sh at each update)
 *   settings.env      the server's settings file, deploy/.env, with every
 *                     password and key (locked by the server itself, deploy.sh)
 *   server.json       the restore facts: ENCRYPTION_KEY, the web address, the
 *                     Google client and the Cloudflare token
 *   backup-keys.json  the keys file (its private key locked with the owner's
 *                     recovery key), so the recovery key alone opens the backup
 *   the restore guide (Bangla and English PDF, no secrets)
 *   manifest.json     every table's row count and every file's size and SHA-256,
 *                     the code's commit and version, and the date
 * Every file but the keys file, the guides and the manifest is locked with the
 * owner's public key (crypt.ts, keys.ts: format 3). Until the owner sets a
 * recovery key, a backup made with v6.3's generated key is locked with that one
 * (format 2), and with no key at all it stays on the server, unlocked, without
 * the settings (format 1). Locked backups go to the owner's Google Drive
 * (drive-copies.ts). The server keeps the newest few (serverKeep), Drive keeps
 * them for driveKeepDays. Only one backup job runs at a time. Platform owner only.
 */

const exec = promisify(execFile);
/** A run still "running" after this long was cut off (the server stopped). */
const STALE_RUN_MS = 6 * 60 * 60 * 1000;
const REPOSITORY = () => process.env.GITHUB_REPOSITORY?.trim() || "mehadih32/Extas-ERP";

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

export type EarlierKeyPair = { pairId: string; setAt: string | null; until: string };

export function earlierKeyPairs(config: BackupConfig): EarlierKeyPair[] {
  return Array.isArray(config.earlierKeyPairs)
    ? (config.earlierKeyPairs as unknown as EarlierKeyPair[])
    : [];
}

export function presentConfig(config: BackupConfig, now = new Date()) {
  const schedule = scheduleOf(config);
  let next: Date | null = null;
  try {
    next = config.isEnabled ? nextRunAt(schedule, config.timezone, now) : null;
  } catch {
    next = null;
  }
  const client = googleClient(config);
  const signingIn =
    config.googleDeviceRef &&
    config.googleDeviceExpiresAt &&
    config.googleDeviceExpiresAt > new Date();
  return {
    schedule,
    /** The schedule in plain words ("Every day at 02:00 and 14:00"). */
    scheduleText: describeSchedule(schedule),
    timezone: config.timezone,
    isEnabled: config.isEnabled,
    nextRunAt: next,
    /** Backups kept on the server (3 to 7). */
    serverKeep: config.serverKeep,
    /** Days each backup stays in Google Drive; null: kept for ever. */
    driveKeepDays: config.driveKeepDays,
    drill: {
      enabled: config.testRestoreEnabled,
      day: config.drillDay,
      time: config.drillTime,
      nextRunAt: config.testRestoreEnabled ? nextDrillAt(config, config.timezone, now) : null,
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
      /** The owner has set their own recovery key (v6.4). */
      set: Boolean(config.publicKey && config.keyPairId),
      /** The key pair's name, written on every backup it locks. */
      pairId: config.keyPairId,
      setAt: config.keySetAt,
      keepInDrive: config.keepKeyInDrive,
      /** When the recovery key was last put in Google Drive; null: not there now. */
      inDriveAt: config.keyInDriveAt,
      /** v6.3's generated key still locks new backups (the owner has not set their own yet). */
      legacyInUse: !config.publicKey && config.recoveryKeyRef ? { id: config.recoveryKeyId } : null,
      /** v6.3's generated key, retired: backups made before then open only with its key card. */
      legacy: config.legacyKeyId
        ? { id: config.legacyKeyId, retiredAt: config.legacyKeyRetiredAt }
        : null,
      /** Earlier key pairs (a forgotten recovery key): backups up to `until` need that key. */
      earlier: earlierKeyPairs(config),
    },
    cloudflare: {
      set: Boolean(config.cloudflareTokenRef),
      zone: config.cloudflareZone,
      /** The token's last 4 characters, to tell tokens apart (the token is never shown). */
      tokenHint: config.cloudflareTokenHint,
      checkedAt: config.cloudflareCheckedAt,
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
    /** Locked with this key (the owner's key pair, or v6.3's key); null: not locked. */
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
 * The one command that restores on a new server (G8): it downloads the small
 * public bootstrap script at the running version's commit, checks its SHA-256
 * and runs it. It holds no secret: the script asks for everything it needs as
 * hidden input. Four lines, each but the last ending in "&&", so it works
 * whether a PDF viewer copies it as four lines or as one; one space between
 * the checksum and the file name (sha256sum reads that too), as copying from a
 * PDF may merge two. Null until deploy.sh has recorded the running version.
 */
export function restoreCommandLines(
  host: Pick<HostVersion, "commit" | "bootstrapSha256">,
): string[] | null {
  if (!host.commit || !host.bootstrapSha256) return null;
  return [
    `c=${host.commit} &&`,
    `curl -fsSL https://raw.githubusercontent.com/${REPOSITORY()}/$c/deploy/bootstrap.sh -o restore.sh &&`,
    `echo "${host.bootstrapSha256} restore.sh" | sha256sum -c &&`,
    "sudo bash restore.sh $c",
  ];
}

/** The one command on one line (the screen's "Copy the command"). */
export function restoreCommand(host: Pick<HostVersion, "commit" | "bootstrapSha256">) {
  return restoreCommandLines(host)?.join(" ") ?? null;
}

/** The new-server facts for the screen and the guide: the command, and what it checks. */
export async function newServerFacts() {
  const host = await hostVersion();
  return {
    command: restoreCommand(host),
    commandLines: restoreCommandLines(host),
    commit: host.commit,
    bootstrapSha256: host.bootstrapSha256,
    version: host.version,
    deployedAt: host.deployedAt,
  };
}

/** Settings, Drive connection, recovery key, the last runs and whether pg_dump is installed. */
export async function getBackupOverview() {
  const config = await getBackupConfig();
  const include = { triggeredBy: { select: { id: true, name: true } } };
  const [lastRun, lastSuccess, lastTest, unsent, pgDump, newServer] = await Promise.all([
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
    newServerFacts(),
  ]);
  const { backupHealth } = await import("@/modules/backups/status");
  return {
    config: presentConfig(config),
    health: await backupHealth(config),
    lastRun: lastRun ? presentRun(lastRun) : null,
    lastSuccess: lastSuccess ? presentRun(lastSuccess) : null,
    lastTestRestore: lastTest ? presentRun(lastTest) : null,
    /** Backups on the server not yet checked in Google Drive. */
    notSent: unsent,
    newServer,
    server: { backupDir: backupRoot(), pgDump },
  };
}

export async function updateBackupConfig(actor: Actor, raw: unknown, meta?: RequestMeta) {
  const input = backupConfigSchema.parse(raw);
  const config = await getBackupConfig();
  const data: Prisma.BackupConfigUpdateInput = {};
  const said: string[] = [];
  if (input.schedule) {
    Object.assign(data, scheduleColumns(input.schedule));
  } else if (input.dailyTime) {
    // v6.3's "daily time": every day at that time.
    Object.assign(
      data,
      scheduleColumns({ ...DEFAULT_SCHEDULE, mode: "DAYS", every: 1, times: [input.dailyTime] }),
    );
  } else if (input.cronSchedule) {
    parseCron(input.cronSchedule);
    data.cronSchedule = input.cronSchedule;
    Object.assign(data, scheduleColumns(scheduleFromCron(input.cronSchedule)));
  }
  if (data.scheduleMode) {
    said.push(
      `schedule: ${describeSchedule(scheduleOf({ ...config, ...(data as Partial<BackupConfig>) }))}`,
    );
  }
  if (input.timezone !== undefined) {
    data.timezone = input.timezone;
    said.push(`timezone: ${input.timezone}`);
  }
  if (input.isEnabled !== undefined) {
    data.isEnabled = input.isEnabled;
    said.push(input.isEnabled ? "backups on" : "backups off");
  }
  if (input.serverKeep !== undefined) {
    data.serverKeep = input.serverKeep;
    said.push(`keep ${input.serverKeep} on the server`);
  }
  if (input.driveKeepDays !== undefined) {
    data.driveKeepDays = input.driveKeepDays;
    said.push(
      input.driveKeepDays === null
        ? "keep in Google Drive for ever"
        : `keep in Google Drive for ${input.driveKeepDays} days`,
    );
  }
  if (input.drillEnabled !== undefined) {
    data.testRestoreEnabled = input.drillEnabled;
    said.push(input.drillEnabled ? "monthly drill on" : "monthly drill off");
  }
  if (input.drillDay !== undefined) {
    data.drillDay = input.drillDay;
    said.push(`drill on day ${input.drillDay}`);
  }
  if (input.drillTime !== undefined) {
    data.drillTime = input.drillTime;
    said.push(`drill at ${input.drillTime}`);
  }
  const updated = await prisma.backupConfig.update({ where: { id: config.id }, data });
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Changed backup settings: ${said.join(", ") || "nothing"}`,
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

/** The run's folder on the server, only if it is safely inside BACKUP_DIR. */
export function runFolder(run: Pick<BackupRun, "dbDumpPath">): string | null {
  if (!run.dbDumpPath) return null;
  const root = backupRoot();
  const folder = path.dirname(path.resolve(root, run.dbDumpPath));
  return folder.startsWith(root + path.sep) ? folder : null;
}

async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
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

/** A file the server locked itself (deploy.sh: the settings file), with its plain facts. */
export type PrelockedFile = {
  file: string;
  plain: { name: string; bytes: number; sha256: string };
};

/** The manifest's format: 1 not locked, 2 v6.3's key, 3 the owner's public key. */
export function formatOf(lock: BackupLock | null): 1 | 2 | 3 {
  if (!lock) return 1;
  return Buffer.isBuffer(lock.key) ? 2 : 3;
}

/**
 * Writes the manifest. With a lock, every file in `plainFiles` is locked first
 * and only the locked file stays; `prelocked` files were locked already (by the
 * server) and `readable` ones stay as they are (the keys file and the guide:
 * nothing secret). Returns the files as written, with their sizes.
 */
export async function sealFolder(
  dir: string,
  plainFiles: string[],
  lock: BackupLock | null,
  about: Record<string, unknown>,
  extra: { prelocked?: PrelockedFile[]; readable?: string[] } = {},
): Promise<{ files: ManifestFile[]; size: number; manifest: string }> {
  const files: ManifestFile[] = [];
  for (const file of plainFiles) {
    if (lock) {
      const locked = `${file}.locked`;
      const facts = await lockFile(lock.key, file, locked);
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
  for (const { file, plain } of extra.prelocked ?? []) {
    files.push({
      name: path.basename(file),
      bytes: (await stat(file)).size,
      sha256: await sha256(file),
      md5: createHash("md5")
        .update(await readFile(file))
        .digest("hex"),
      plain,
    });
  }
  for (const file of extra.readable ?? []) {
    const data = await readFile(file);
    files.push({
      name: path.basename(file),
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      md5: createHash("md5").update(data).digest("hex"),
    });
  }
  const format = formatOf(lock);
  const manifest = path.join(dir, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify(
      {
        app: "Extas ERP",
        format,
        locked: Boolean(lock),
        keyId: lock?.id ?? null,
        ...about,
        files,
        restore:
          format === 3
            ? [
                "Locked with the owner's backup key: restore on a new server with the one command in the restore guide (deploy/bootstrap.sh), or with Restore on the Backups screen. The recovery key opens backup-keys.json.",
              ]
            : format === 2
              ? [
                  "Locked with the v6.3 recovery key (the key card): restore with deploy/bootstrap.sh on a new server, or Restore on the Backups screen.",
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

/** What a new server needs before the ERP runs there (inside a locked backup only). */
export type RestoreFacts = {
  format: 2;
  encryptionKey: string | null;
  /** Keys of servers restored onto this one (ENCRYPTION_OLD_KEYS): they open older secrets. */
  encryptionOldKeys: string[];
  appUrl: string | null;
  appDomain: string | null;
  ownerEmail: string | null;
  createdAt: string;
  google: { clientId: string; clientSecret: string } | null;
  cloudflare: { zone: string; zoneId: string | null; token: string } | null;
};

export async function restoreFacts(config: BackupConfig, createdAt: Date): Promise<RestoreFacts> {
  const appUrl = process.env.APP_URL ?? null;
  let appDomain: string | null = null;
  try {
    appDomain = appUrl ? new URL(appUrl).hostname : null;
  } catch {
    appDomain = null;
  }
  let cloudflare: RestoreFacts["cloudflare"] = null;
  if (config.cloudflareTokenRef && config.cloudflareZone) {
    try {
      cloudflare = {
        zone: config.cloudflareZone,
        zoneId: config.cloudflareZoneId,
        token: decryptSecret(config.cloudflareTokenRef),
      };
    } catch {
      cloudflare = null;
    }
  }
  return {
    format: 2,
    encryptionKey: process.env.ENCRYPTION_KEY ?? null,
    encryptionOldKeys: (process.env.ENCRYPTION_OLD_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    appUrl,
    appDomain,
    // A new server checks every screen as this owner after the restore.
    ownerEmail: await platformOwnerEmail(),
    createdAt: createdAt.toISOString(),
    google: googleClient(config),
    cloudflare,
  };
}

/** Why a part is not in a backup, in plain words (for the report and the screen). */
export const MISSING = {
  code: "The code at the running version: the server makes it at each update, and has not yet.",
  settings:
    "The server's settings file (deploy/.env): the server locks it with your backup key at each update and within a minute of setting the key, and has not yet.",
  settingsNeedsKey:
    "The server's settings file (deploy/.env): it is put in backups once you set your own recovery key.",
} as const;

/**
 * The parts deploy.sh leaves in BACKUP_DIR/.host, copied into the backup
 * folder: the code bundle (when it is the running version's), and the settings
 * file locked with this very key pair.
 */
async function hostParts(dir: string, lock: BackupLock | null, host: HostVersion) {
  const out: { code: string | null; settings: PrelockedFile | null; missing: string[] } = {
    code: null,
    settings: null,
    missing: [],
  };
  const bundle = path.join(hostRoot(), "code.bundle");
  if (host.commit && (await exists(bundle))) {
    out.code = path.join(dir, "code.bundle");
    await copyFile(bundle, out.code);
  } else {
    out.missing.push(MISSING.code);
  }
  if (formatOf(lock) !== 3) {
    out.missing.push(MISSING.settingsNeedsKey);
    return out;
  }
  try {
    const lockedPath = path.join(hostRoot(), "settings.env.locked");
    const facts = JSON.parse(
      await readFile(path.join(hostRoot(), "settings.env.json"), "utf8"),
    ) as {
      pairId?: string;
      plain?: { bytes?: number; sha256?: string };
      locked?: { sha256?: string };
    };
    const head = await readFile(lockedPath).then((b) => b.subarray(0, 64));
    if (
      facts.pairId !== lock!.id ||
      lockedForPair(head) !== lock!.id ||
      typeof facts.plain?.bytes !== "number" ||
      !/^[0-9a-f]{64}$/.test(facts.plain.sha256 ?? "") ||
      facts.locked?.sha256 !== (await sha256(lockedPath))
    ) {
      throw new Error("not locked with this key");
    }
    const copy = path.join(dir, "settings.env.locked");
    await copyFile(lockedPath, copy);
    out.settings = {
      file: copy,
      plain: { name: "settings.env", bytes: facts.plain.bytes, sha256: facts.plain.sha256! },
    };
  } catch {
    out.missing.push(MISSING.settings);
  }
  return out;
}

export type BackupReport = {
  format: 1 | 2 | 3;
  tables: number;
  records: number;
  files: number;
  fileBytes: number;
  commit: string | null;
  version: string | null;
  /** Parts not in this backup, in plain words. */
  missing: string[];
};

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
  let lock: BackupLock | null = null;

  try {
    lock = backupLock(config);
    await mkdir(dir, { recursive: true });
    const host = await hostVersion();

    // The database, and every table's row count at the same moment.
    const db = path.join(dir, "database.dump");
    const tables = await dumpWithCounts(db);

    // Every uploaded and generated file; never the backups themselves when
    // BACKUP_DIR sits inside UPLOAD_DIR.
    const uploads = uploadRoot();
    const inside = path.relative(uploads, root);
    const skip = inside && !inside.startsWith("..") && !path.isAbsolute(inside) ? root : undefined;
    const uploaded = await listFiles(uploads, skip);
    const media = path.join(dir, "media.tar.gz");
    await packFiles(uploads, uploaded, media);
    const contents = contentsOf(tables, uploaded);

    const parts = await hostParts(dir, lock, host);
    // The restore facts go only into a locked backup, never into a plain one.
    const server = lock ? path.join(dir, "server.json") : null;
    if (server) {
      await writeFile(server, JSON.stringify(await restoreFacts(config, run.startedAt)), {
        mode: 0o600,
      });
    }
    const readable: string[] = [];
    if (formatOf(lock) === 3 && config.lockedKeyFile) {
      const keys = path.join(dir, "backup-keys.json");
      await writeFile(keys, config.lockedKeyFile);
      readable.push(keys);
    }
    for (const guide of await guideFiles()) {
      const copy = path.join(dir, path.basename(guide));
      await copyFile(guide, copy);
      readable.push(copy);
    }
    const report: BackupReport = {
      format: formatOf(lock),
      tables: Object.keys(contents.tables).length,
      records: contents.records,
      files: contents.files.length,
      fileBytes: contents.fileBytes,
      commit: host.commit,
      version: host.version,
      missing: parts.missing,
    };
    const sealed = await sealFolder(
      dir,
      [db, media, ...(parts.code ? [parts.code] : []), ...(server ? [server] : [])],
      lock,
      {
        createdAt: run.startedAt.toISOString(),
        timezone: config.timezone,
        kind: "BACKUP",
        trigger: run.trigger,
        companies: await prisma.company.count(),
        version: host.version,
        commit: host.commit,
        records: contents.records,
        tables: contents.tables,
        uploads: contents.files,
        uploadBytes: contents.fileBytes,
        missing: parts.missing,
      },
      { prelocked: parts.settings ? [parts.settings] : [], readable },
    );
    const dbName = sealed.files.find((f) => f.name.startsWith("database.dump"))!.name;
    const mediaName = sealed.files.find((f) => f.name.startsWith("media.tar.gz"))?.name;
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        name: stamp,
        keyId: lock?.id ?? null,
        dbDumpPath: path.relative(root, path.join(dir, dbName)),
        mediaArchivePath: mediaName ? path.relative(root, path.join(dir, mediaName)) : null,
        sizeBytes: BigInt(sealed.size),
        report: report as unknown as Prisma.InputJsonObject,
      },
    });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    const failed = await prisma.backupRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: reasonFor(error) },
    });
    const { raiseProblem } = await import("@/modules/backups/status");
    await raiseProblem(
      "failed",
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
      driveError: !lock
        ? "Kept on the server only: set your recovery key on the Backups screen. Backups are locked with it before they go to Google Drive."
        : !config.credentialsRef
          ? "Kept on the server only: Google Drive is not connected."
          : null,
    },
  });
  if (lock && config.credentialsRef) {
    const { sendToDrive } = await import("@/modules/backups/drive-copies");
    finished = await sendToDrive(finished.id);
    if (!finished.checkedAt) {
      const { raiseProblem } = await import("@/modules/backups/status");
      await raiseProblem(
        "not-in-drive",
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
  try {
    const { watchBackups } = await import("@/modules/backups/status");
    await watchBackups();
  } catch (error) {
    console.error("[backups] could not check the backups' health", error);
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
    const { raiseProblem } = await import("@/modules/backups/status");
    await raiseProblem("failed", "Backup failed", reasonFor(error), run.id);
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
        ? "This backup is in Google Drive; the server keeps only the newest backups."
        : "This backup's files were removed from the server (it keeps only the newest backups).",
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
