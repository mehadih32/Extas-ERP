import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { BackupConfig, BackupRun } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  alertOwner,
  backupLock,
  backupRoot,
  driveRoot,
  driveToken,
  getBackupConfig,
  reasonFor,
  safetyCopyRoot,
} from "@/modules/backups/backup-core";
import {
  claimRun,
  type ManifestFile,
  runFolder,
  sealFolder,
} from "@/modules/backups/backup.service";
import { type DriveBackup, listBackupFolders } from "@/modules/backups/drive-fetch";
import { findRootFiles, putRootFile } from "@/modules/backups/drive-root";
import * as drive from "@/modules/backups/google-drive";
import { nextRunAt, scheduleOf } from "@/modules/backups/schedule";

export { type DriveBackup, type FetchedBackup, fetchBackup } from "@/modules/backups/drive-fetch";

/*
 * Google Drive's copies. Each backup goes to its own folder inside "Extas ERP
 * Backups"; every file Google keeps is checked against the server's (its size
 * and MD5), and only then is the folder labelled "checked". The server keeps
 * its own copy too, of the newest `serverKeep` backups (G2); Drive keeps each
 * backup for `driveKeepDays` days (or for ever), and never deletes the newest.
 * A backup that did not reach Drive stays on the server and is sent again
 * within the hour. Update safety copies (deploy.sh, kept on the server for 24
 * hours) are locked and sent too; Drive keeps the newest 10 of them. The keys
 * file sits beside the backups in Drive, so the recovery key alone opens them.
 */

/** Safety copies kept in Drive. */
const SAFETY_COPIES_KEPT = 10;
/** A run not sent is tried again after this long. */
const RETRY_MS = 60 * 60 * 1000;
/** A safety copy is sent once deploy.sh has finished writing it. */
const SETTLED_MS = 2 * 60 * 1000;
const lastTry = new Map<string, number>();

/** Sends a finished run's files to Drive and checks Google's copy; returns the run as recorded. */
export async function sendToDrive(runId: string): Promise<BackupRun> {
  lastTry.set(runId, Date.now());
  const run = await prisma.backupRun.findUniqueOrThrow({ where: { id: runId } });
  const config = await getBackupConfig();
  const folder = runFolder(run);
  let made: string | null = null;
  let token: string | null = null;
  try {
    if (!folder) throw new Error("the backup's files are not on the server any more");
    if (!run.keyId) throw new Error("the backup is not locked: set your recovery key first");
    token = await driveToken(config);
    if (!token) throw new Error("Google Drive is not connected");
    const manifestPath = path.join(folder, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      createdAt: string;
      format?: number;
      files: ManifestFile[];
    };
    const rootId = await driveRoot(config, token);
    // A half-sent copy from an earlier try goes first.
    for (const old of await drive.listFolders(token, rootId)) {
      if (old.name === run.name && old.appProperties?.checked !== "yes") {
        await drive.deleteFile(token, old.id);
      }
    }
    made = (
      await drive.createFolder(token, run.name ?? path.basename(folder), rootId, {
        extas: "backup",
        kind: run.kind,
        createdAt: manifest.createdAt,
        ...nextLabel(config, run.kind, manifest.createdAt),
      })
    ).id;
    for (const file of manifest.files) {
      const sent = await drive.uploadFile(token, path.join(folder, file.name), made);
      const kept = await drive.fileInfo(token, sent.id);
      if (Number(kept.size) !== file.bytes || (file.md5 && kept.md5Checksum !== file.md5)) {
        throw new Error(
          `Google's copy of ${file.name} does not match the server's (${kept.size} bytes, MD5 ${kept.md5Checksum}); it is sent again`,
        );
      }
    }
    await drive.uploadFile(token, manifestPath, made, "application/json");
    const bytes = Number(run.sizeBytes ?? 0);
    await drive.label(token, made, {
      checked: "yes",
      bytes: String(bytes),
      keyId: run.keyId,
      format: String(manifest.format ?? 2),
    });
    const checked = await prisma.backupRun.update({
      where: { id: run.id },
      data: { driveFileId: made, checkedAt: new Date(), driveError: null },
    });
    lastTry.delete(run.id);
    await ensureKeysFile(config, token, rootId).catch((error: unknown) =>
      console.error("[backups] the keys file is not in Drive", reasonFor(error)),
    );
    if (run.kind !== "SAFETY_COPY") return checked;
    // A safety copy's locked copy goes once Google's is checked (deploy.sh deletes its original).
    await rm(folder, { recursive: true, force: true });
    return prisma.backupRun.update({
      where: { id: checked.id },
      data: { filesDeletedAt: new Date() },
    });
  } catch (error) {
    if (made && token) await drive.deleteFile(token, made).catch(() => undefined);
    const reconnect = error instanceof drive.DriveError && error.reconnect;
    return prisma.backupRun.update({
      where: { id: run.id },
      data: {
        driveError: reconnect
          ? "Google Drive access was revoked or expired: connect Google Drive again. The backup is saved on the server."
          : `Saved on the server, but not in Google Drive: ${reasonFor(error)}`,
      },
    });
  }
}

/**
 * When the owner's schedule makes the next backup after this one, as a label on
 * its folder in Drive: the late-backup alert on GitHub (scripts/backup-watch.mjs)
 * reads it there, so it knows the schedule without asking this server. None for
 * a safety copy, or while backups are off.
 */
export function nextLabel(
  config: BackupConfig,
  kind: BackupRun["kind"],
  createdAt: string,
): { nextAt?: string } {
  const made = new Date(createdAt);
  if (kind !== "BACKUP" || !config.isEnabled || Number.isNaN(made.getTime())) return {};
  try {
    const next = nextRunAt(scheduleOf(config), config.timezone, made);
    return next ? { nextAt: next.toISOString() } : {};
  } catch {
    // A schedule that cannot be read never stops the backup reaching Drive.
    return {};
  }
}

/** Sends again, once an hour, the backups that did not reach Drive. */
export async function sendUnsent(now = Date.now()): Promise<number> {
  const config = await getBackupConfig();
  if (!config.credentialsRef) return 0;
  const waiting = await prisma.backupRun.findMany({
    where: {
      kind: { in: ["BACKUP", "SAFETY_COPY"] },
      status: "SUCCEEDED",
      checkedAt: null,
      filesDeletedAt: null,
      keyId: { not: null },
    },
    orderBy: { startedAt: "asc" },
  });
  let sent = 0;
  for (const run of waiting) {
    if (now - (lastTry.get(run.id) ?? 0) < RETRY_MS) continue;
    if ((await sendToDrive(run.id)).checkedAt) sent += 1;
  }
  return sent;
}

/**
 * Locks and sends the update safety copies deploy.sh saved (it deletes its own
 * after 24 hours). Each is sent once.
 */
export async function sendSafetyCopies(now = Date.now()): Promise<number> {
  const source = safetyCopyRoot();
  if (!source) return 0;
  const config = await getBackupConfig();
  const key = backupLock(config);
  if (!key || !config.credentialsRef) return 0;
  let sent = 0;
  for (const entry of await readdir(source, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^before-(update|restore)-[\w-]+$/.test(entry.name)) continue;
    const dump = path.join(source, entry.name, "database.dump");
    const info = await stat(dump).catch(() => null);
    if (!info || info.size === 0 || now - info.mtimeMs < SETTLED_MS) continue;
    const known = await prisma.backupRun.findFirst({
      where: { kind: "SAFETY_COPY", name: entry.name },
      select: { id: true },
    });
    if (known) continue;
    let run: BackupRun;
    try {
      run = await claimRun("SCHEDULED", null, "SAFETY_COPY", entry.name);
    } catch (error) {
      if (error instanceof AppError && error.code === "CONFLICT") return sent;
      throw error;
    }
    const dir = path.join(backupRoot(), ".sending", entry.name);
    try {
      await mkdir(dir, { recursive: true });
      const copy = path.join(dir, "database.dump");
      await copyFile(dump, copy);
      const sealed = await sealFolder(dir, [copy], key, {
        createdAt: info.mtime.toISOString(),
        kind: "SAFETY_COPY",
        about: "The database just before an update or a restore (deploy.sh / restore.sh).",
      });
      await prisma.backupRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          keyId: key.id,
          dbDumpPath: path.relative(backupRoot(), path.join(dir, sealed.files[0]!.name)),
          sizeBytes: BigInt(sealed.size),
        },
      });
      const result = await sendToDrive(run.id);
      if (result.checkedAt) sent += 1;
      else {
        await alertOwner(
          "Safety copy not in Google Drive",
          `The ${entry.name} safety copy is on the server (kept 24 hours) but not in Google Drive yet (${result.driveError}). It is sent again within the hour.`,
          run.id,
        );
      }
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      const failed = await prisma.backupRun.update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date(), error: reasonFor(error) },
      });
      await alertOwner(
        "Safety copy not sent",
        `The ${entry.name} safety copy could not be locked for Google Drive: ${failed.error}. It is still on the server for 24 hours.`,
        run.id,
      );
    }
  }
  return sent;
}

/** The backups in Google Drive, newest first. */
export async function listDriveBackups(): Promise<{ connected: boolean; items: DriveBackup[] }> {
  const config = await getBackupConfig();
  let token: string | null;
  try {
    token = await driveToken(config);
  } catch (error) {
    if (error instanceof drive.DriveError) throw new AppError("UNAVAILABLE", error.message);
    throw error;
  }
  if (!token) return { connected: false, items: [] };
  const items = await listBackupFolders(token, await driveRoot(config, token));
  return { connected: true, items };
}

/**
 * The keys file (public key, private key locked with the recovery key) beside
 * the backups in Drive: put there, or replaced, when it is not the current one.
 */
export async function ensureKeysFile(config: BackupConfig, token: string, rootId: string) {
  if (!config.lockedKeyFile || !config.keyPairId) return false;
  const sha = createHash("sha256").update(config.lockedKeyFile).digest("hex");
  const there = await findRootFiles(token, rootId, "keys");
  if (there.length === 1 && there[0]!.appProperties?.sha256 === sha) return false;
  await putRootFile(token, rootId, "keys", Buffer.from(config.lockedKeyFile), {
    pairId: config.keyPairId,
    sha256: sha,
  });
  return true;
}

/**
 * The owner's keeping rules (G2). On the server: the newest `serverKeep`
 * backups (a backup is kept until a newer one is made, even when it is not in
 * Drive yet); a safety copy's locked copy is kept for the retention period
 * while it waits for Drive. In Drive: each checked backup for `driveKeepDays`
 * days (null: for ever), never the newest; the newest 10 safety copies; a copy
 * never checked goes after a day.
 */
export async function pruneBackups(config: BackupConfig, now = new Date()) {
  let removed = 0;
  const token = await driveToken(config).catch(() => null);
  if (token) {
    const folders = (await listBackupFolders(token, await driveRoot(config, token))).map((f) => ({
      id: f.folderId,
      ...f,
    }));
    const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
    const checked = folders.filter((f) => f.checked);
    const backups = checked.filter((f) => f.kind === "BACKUP");
    const cutoff =
      config.driveKeepDays === null
        ? null
        : new Date(now.getTime() - config.driveKeepDays * 86_400_000).toISOString();
    const keep = new Set([
      ...backups.slice(0, 1).map((f) => f.id),
      ...backups.filter((f) => cutoff === null || f.createdAt >= cutoff).map((f) => f.id),
      ...checked
        .filter((f) => f.kind === "SAFETY_COPY")
        .slice(0, SAFETY_COPIES_KEPT)
        .map((f) => f.id),
    ]);
    for (const f of folders) {
      if (keep.has(f.id) || (!f.checked && f.createdAt > dayAgo)) continue;
      await drive.deleteFile(token, f.id);
      removed += 1;
    }
  }

  // The server: the newest `serverKeep` backups.
  const onServer = await prisma.backupRun.findMany({
    where: { kind: "BACKUP", status: "SUCCEEDED", filesDeletedAt: null },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  });
  const safetyCutoff = new Date(now.getTime() - config.retentionDays * 86_400_000);
  const old = [
    ...onServer.slice(Math.max(1, config.serverKeep)),
    ...(await prisma.backupRun.findMany({
      where: {
        OR: [
          { kind: "SAFETY_COPY", startedAt: { lt: safetyCutoff } },
          { kind: { in: ["BACKUP", "SAFETY_COPY"] }, status: "FAILED" },
        ],
        filesDeletedAt: null,
        status: { in: ["SUCCEEDED", "FAILED"] },
      },
    })),
  ];
  for (const run of old) {
    const folder = runFolder(run);
    if (folder) await rm(folder, { recursive: true, force: true });
    await prisma.backupRun.update({ where: { id: run.id }, data: { filesDeletedAt: now } });
    removed += 1;
  }
  return removed;
}
