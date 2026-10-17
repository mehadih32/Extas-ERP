import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { backupRoot, getBackupConfig } from "@/modules/backups/backup-core";
import { settleFinishedRuns } from "@/modules/backups/backup.service";

/*
 * The first thing the ERP does after a restore (deploy/restore.sh leaves
 * BACKUP_DIR/.restored.json once the database is in, before the app starts):
 *   - G4: a restore from the Backups screen keeps this server's own backup
 *     settings (the recovery key, the schedule, Google Drive, Cloudflare), saved
 *     just before the restore, not the older ones inside the backup. They are put
 *     back column by column (only the columns this database has), after the
 *     database was brought up to this version of the code;
 *   - G5: the backup's own run, still "running" in its database (the dump is
 *     taken while it runs), is finished, and any other run left open is closed,
 *     so the next backup does not wait six hours for them.
 */

export const RESTORED_MARK = ".restored.json";

type RestoredMark = {
  name?: unknown;
  /** Restored from its checked copy in Google Drive (the screen, or a new server). */
  fromDrive?: unknown;
  backupCreatedAt?: unknown;
  restoredAt?: unknown;
  keptSettings?: unknown;
};

/** Puts back the backup settings saved before the restore (a row as JSON). */
async function keepSettings(saved: Record<string, unknown>) {
  const config = await getBackupConfig();
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name::text AS column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'BackupConfig'`;
  const names = columns
    .map((c) => c.column_name)
    .filter((name) => name !== "id" && Object.hasOwn(saved, name));
  if (names.length === 0) return false;
  const list = names.map((name) => `"${name.replace(/"/g, '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `UPDATE "BackupConfig" SET (${list}) = (SELECT ${list} FROM json_populate_record(NULL::"BackupConfig", $1::json)) WHERE id = $2`,
    JSON.stringify(saved),
    config.id,
  );
  return true;
}

/** Finishes the runs the restored database holds as still going. */
async function closeOpenRuns(mark: RestoredMark, now: Date): Promise<number> {
  // Its files still on this server: recorded from them (backup.service.ts).
  const settled = await settleFinishedRuns();
  // Only runs the restored database brought with it, never one started since.
  const restoredAt = typeof mark.restoredAt === "string" ? new Date(mark.restoredAt) : now;
  const open = await prisma.backupRun.findMany({
    where: {
      status: { in: ["QUEUED", "RUNNING"] },
      startedAt: { lte: Number.isNaN(restoredAt.getTime()) ? now : restoredAt },
    },
    orderBy: { startedAt: "desc" },
  });
  const createdAt = typeof mark.backupCreatedAt === "string" ? mark.backupCreatedAt : null;
  // The backup's own run: the one started at the backup's time, else the newest backup run.
  const own =
    open.find((r) => r.kind === "BACKUP" && createdAt && r.startedAt.toISOString() === createdAt) ??
    (createdAt ? undefined : open.find((r) => r.kind === "BACKUP"));
  const name = typeof mark.name === "string" ? mark.name.slice(0, 100) : null;
  let closed = settled;
  for (const run of open) {
    const { count } = await prisma.backupRun.updateMany({
      where: { id: run.id, status: { in: ["QUEUED", "RUNNING"] } },
      data:
        run.id === own?.id
          ? {
              status: "SUCCEEDED",
              finishedAt: now,
              name: run.name ?? name,
              // Its files are not on this server (else they were recorded from them above).
              filesDeletedAt: now,
            }
          : {
              status: "FAILED",
              finishedAt: now,
              error: "Not finished: the database was restored from a backup taken while it ran.",
            },
    });
    closed += count;
  }
  // It came back from its checked copy in Google Drive, so it is there: never sent again.
  const ownRun = createdAt ? { startedAt: new Date(createdAt) } : own ? { id: own.id } : null;
  if (mark.fromDrive === true && ownRun) {
    await prisma.backupRun.updateMany({
      where: { ...ownRun, kind: "BACKUP", status: "SUCCEEDED" },
      data: { checkedAt: now, driveError: null },
    });
  }
  return closed;
}

/**
 * Called once when the ERP starts (scheduler.ts), before anything else in the
 * backups runs. Null when there was no restore.
 */
export async function afterRestore(
  now = new Date(),
): Promise<{ keptSettings: boolean; closedRuns: number } | null> {
  const file = path.join(backupRoot(), RESTORED_MARK);
  let mark: RestoredMark;
  try {
    mark = JSON.parse(await readFile(file, "utf8")) as RestoredMark;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    // A mark that cannot be read is not used again.
    await rm(file, { force: true });
    throw error;
  }
  const saved = mark.keptSettings;
  const keptSettings =
    saved && typeof saved === "object" && !Array.isArray(saved)
      ? await keepSettings(saved as Record<string, unknown>)
      : false;
  if (keptSettings) {
    // The server locks its settings file with the live key again.
    const { writeHostKey } = await import("@/modules/backups/recovery-key.service");
    await writeHostKey(await getBackupConfig());
  }
  const closedRuns = await closeOpenRuns(mark, now);
  await rm(file, { force: true });
  return { keptSettings, closedRuns };
}
