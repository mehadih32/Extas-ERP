import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { afterRestore } from "@/modules/backups/after-restore";
import { getBackupConfig, runBackup, settleFinishedRuns } from "@/modules/backups/backup.service";
import { sendSafetyCopies, sendUnsent } from "@/modules/backups/drive-copies";
import { ensureLocalGuides, guideTick } from "@/modules/backups/guide.service";
import { writeHostKey } from "@/modules/backups/recovery-key.service";
import { recordRestoreResult } from "@/modules/backups/restore.service";
import { drillDueAt, previousRunAt, scheduleOf } from "@/modules/backups/schedule";
import { onDrill, onStandby } from "@/modules/backups/standby";
import { watchBackups } from "@/modules/backups/status";
import { runTestRestore } from "@/modules/backups/test-restore";

/*
 * The backup clock. Started once per server process (instrumentation.ts);
 * every minute it checks whether the latest scheduled time (the owner's
 * schedule, schedule.ts) has a backup yet (a backup missed while the server was
 * down runs as soon as it is back), and the same for the monthly restore drill.
 * It also sends again what did not reach Google Drive, sends new update safety
 * copies, records a restore the server finished, and tells the owner when a
 * backup failed or is late (status.ts), and keeps the restore guide up to date
 * on the server and in Google Drive (guide.service.ts). When several
 * processes run, the single-job lock lets only one of them start each job.
 */

const CHECK_EVERY_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

const conflict = (error: unknown) => error instanceof AppError && error.code === "CONFLICT";

/** Starts the scheduled backup if one is due; returns the run it started, if any. */
export async function backupTick(now: Date = new Date()) {
  try {
    const config = await getBackupConfig();
    if (!config.isEnabled) return null;
    const due = previousRunAt(scheduleOf(config), config.timezone, now);
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

/** Starts the monthly restore drill if one is due (and Drive is connected). */
export async function testRestoreTick(now: Date = new Date()) {
  try {
    const config = await getBackupConfig();
    if (!config.testRestoreEnabled || !config.credentialsRef) return null;
    const due = drillDueAt(config, config.timezone, now);
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
    console.error("[backups] scheduled restore drill could not start", error);
    return null;
  }
}

/** Everything the clock does each minute; each part on its own, so one failing stops nothing. */
export async function backupClock(now: Date = new Date()) {
  // A restore drill copy (test mode) runs no backup clock at all: no backup, no Drive.
  if (await onDrill()) return;
  // A copy on standby after a restore backs up too (G2): one that is used after all
  // is never left without backups. Its backups are marked as made on standby. It never
  // replaces the restore guide, restore.sh or restore-tool.py beside the backups in
  // Drive: those belong to the ERP in use, which may be newer than this copy.
  await recordRestoreResult().catch((e: unknown) => console.error("[backups] restore result", e));
  await backupTick(now);
  await testRestoreTick(now);
  await sendSafetyCopies(now.getTime()).catch((e: unknown) => {
    if (!conflict(e)) console.error("[backups] safety copies not sent", e);
  });
  await sendUnsent(now.getTime()).catch((e: unknown) =>
    console.error("[backups] backups not sent again", e),
  );
  await watchBackups(now).catch((e: unknown) =>
    console.error("[backups] could not check the backups' health", e),
  );
  if (await onStandby()) {
    // The guide on this server's disk (put in each backup) is still made.
    await ensureLocalGuides(now).catch((e: unknown) =>
      console.error("[backups] the restore guide could not be made", e),
    );
    return;
  }
  await guideTick(now).catch((e: unknown) =>
    console.error("[backups] the restore guide could not be made", e),
  );
}

export function startBackupScheduler() {
  if (timer) return;
  void (async () => {
    // Just after a restore: this server's own backup settings back, the runs the
    // backup left open finished (after-restore.ts). First, before anything else.
    await afterRestore().catch((error: unknown) =>
      console.error("[backups] could not finish after the restore", error),
    );
    // A backup whose run was left open (the server stopped, or this database was
    // restored from that very backup) is recorded as done when its files are all there.
    await settleFinishedRuns().catch((error: unknown) =>
      console.error("[backups] could not check unfinished backups", error),
    );
    // The public key for the server's own settings file (a restored or new data folder lacks it).
    await getBackupConfig()
      .then(writeHostKey)
      .catch((error: unknown) => console.error("[backups] could not write the public key", error));
  })();
  // The guide for the backups (no details in it), before the first backup.
  void ensureLocalGuides().catch((error: unknown) =>
    console.error("[backups] the restore guide could not be made", error),
  );
  timer = setInterval(() => void backupClock(), CHECK_EVERY_MS);
  timer.unref();
  console.log("[backups] backup scheduler started");
}

export function stopBackupScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
