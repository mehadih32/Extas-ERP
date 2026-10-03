import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getBackupConfig, runBackup, settleFinishedRuns } from "@/modules/backups/backup.service";
import { previousRun } from "@/modules/backups/cron";

/*
 * The daily backup clock. Started once per server process (instrumentation.ts);
 * every minute it checks whether the latest scheduled time has a backup yet. A
 * backup missed while the server was down runs as soon as it is back. When
 * several processes run, the single-backup lock lets only one of them start it.
 */

const CHECK_EVERY_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

/** Starts the scheduled backup if one is due; returns the run it started, if any. */
export async function backupTick(now: Date = new Date()) {
  try {
    const config = await getBackupConfig();
    if (!config.isEnabled) return null;
    const due = previousRun(config.cronSchedule, config.timezone, now);
    if (!due) return null;
    const done = await prisma.backupRun.findFirst({
      where: { trigger: "SCHEDULED", startedAt: { gte: due } },
      select: { id: true },
    });
    if (done) return null;
    return await runBackup({ trigger: "SCHEDULED" });
  } catch (error) {
    // Another process (or a manual backup) is already running one.
    if (error instanceof AppError && error.code === "CONFLICT") return null;
    console.error("[backups] scheduled backup could not start", error);
    return null;
  }
}

export function startBackupScheduler() {
  if (timer) return;
  // A backup whose run was left open (the server stopped, or this database was
  // restored from that very backup) is recorded as done when its files are all there.
  void settleFinishedRuns().catch((error: unknown) =>
    console.error("[backups] could not check unfinished backups", error),
  );
  timer = setInterval(() => void backupTick(), CHECK_EVERY_MS);
  timer.unref();
  console.log("[backups] daily backup scheduler started");
}

export function stopBackupScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
