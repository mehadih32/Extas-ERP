import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getBackupConfig, runBackup, settleFinishedRuns } from "@/modules/backups/backup.service";
import { previousRun } from "@/modules/backups/cron";
import { sendSafetyCopies, sendUnsent } from "@/modules/backups/drive-copies";
import { recordRestoreResult } from "@/modules/backups/restore.service";
import { runTestRestore } from "@/modules/backups/test-restore";

/*
 * The backup clock. Started once per server process (instrumentation.ts);
 * every minute it checks whether the latest scheduled time has a backup yet (a
 * backup missed while the server was down runs as soon as it is back), and the
 * same for the weekly test restore. It also sends again what did not reach
 * Google Drive, sends new update safety copies, and records a restore the
 * server finished. When several processes run, the single-job lock lets only
 * one of them start each job.
 */

const CHECK_EVERY_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

const conflict = (error: unknown) => error instanceof AppError && error.code === "CONFLICT";

/** Starts the scheduled backup if one is due; returns the run it started, if any. */
export async function backupTick(now: Date = new Date()) {
  try {
    const config = await getBackupConfig();
    if (!config.isEnabled) return null;
    const due = previousRun(config.cronSchedule, config.timezone, now);
    if (!due) return null;
    const done = await prisma.backupRun.findFirst({
      where: { kind: "BACKUP", trigger: "SCHEDULED", startedAt: { gte: due } },
      select: { id: true },
    });
    if (done) return null;
    return await runBackup({ trigger: "SCHEDULED" });
  } catch (error) {
    // Another process (or a manual backup) is already running one.
    if (conflict(error)) return null;
    console.error("[backups] scheduled backup could not start", error);
    return null;
  }
}

/** Starts the weekly test restore if one is due (and Drive and the recovery key are ready). */
export async function testRestoreTick(now: Date = new Date()) {
  try {
    const config = await getBackupConfig();
    if (!config.testRestoreEnabled || !config.credentialsRef || !config.recoveryKeyRef) return null;
    const due = previousRun(config.testRestoreSchedule, config.timezone, now);
    if (!due) return null;
    const done = await prisma.backupRun.findFirst({
      where: { kind: "TEST_RESTORE", trigger: "SCHEDULED", startedAt: { gte: due } },
      select: { id: true },
    });
    if (done) return null;
    // Nothing to test until a backup is checked in Drive.
    const checked = await prisma.backupRun.findFirst({
      where: { kind: "BACKUP", checkedAt: { not: null } },
      select: { id: true },
    });
    if (!checked) return null;
    return await runTestRestore({ trigger: "SCHEDULED" });
  } catch (error) {
    if (conflict(error)) return null;
    console.error("[backups] scheduled test restore could not start", error);
    return null;
  }
}

/** Everything the clock does each minute; each part on its own, so one failing stops nothing. */
export async function backupClock(now: Date = new Date()) {
  await recordRestoreResult().catch((e: unknown) => console.error("[backups] restore result", e));
  await backupTick(now);
  await testRestoreTick(now);
  await sendSafetyCopies(now.getTime()).catch((e: unknown) => {
    if (!conflict(e)) console.error("[backups] safety copies not sent", e);
  });
  await sendUnsent(now.getTime()).catch((e: unknown) =>
    console.error("[backups] backups not sent again", e),
  );
}

export function startBackupScheduler() {
  if (timer) return;
  // A backup whose run was left open (the server stopped, or this database was
  // restored from that very backup) is recorded as done when its files are all there.
  void settleFinishedRuns().catch((error: unknown) =>
    console.error("[backups] could not check unfinished backups", error),
  );
  timer = setInterval(() => void backupClock(), CHECK_EVERY_MS);
  timer.unref();
  console.log("[backups] daily backup scheduler started");
}

export function stopBackupScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
