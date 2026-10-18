import type { BackupConfig } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { alertOwner, getBackupConfig } from "@/modules/backups/backup-core";
import { previousRunAt, scheduleOf } from "@/modules/backups/schedule";
import { DRILL_LINE, onDrill, onStandby, STANDBY_LINE } from "@/modules/backups/standby";

/*
 * How the backups are doing, in one plain line for the Backups screen (G10),
 * and the owner's alert (inbox and Telegram) when a backup fails, is late or
 * does not reach Google Drive: once per problem, and once more when the
 * backups work again.
 */

/** A scheduled backup not started this long after its time is late. */
export const LATE_AFTER_MS = 90 * 60 * 1000;
/** A backup not in Google Drive this long after it was made is a problem. */
const NOT_IN_DRIVE_AFTER_MS = 2 * 60 * 60 * 1000;
/** A backup started this early still counts for a scheduled time. */
const EARLY_MS = 10 * 60 * 1000;

export type ProblemKind = "failed" | "late" | "not-in-drive";

export type BackupHealth = {
  level: "good" | "warning" | "danger";
  /** "Last backup 2 hours ago, safe in Google Drive". */
  line: string;
  /** Hours of work lost if the server were lost now; null: everything since the start. */
  loseAtMostHours: number | null;
  /** "If the server is lost now, you lose at most 3 hours of work." */
  loseLine: string;
  lastBackupAt: Date | null;
  lastInDriveAt: Date | null;
  problem: { kind: ProblemKind; text: string } | null;
};

/** "2 hours ago", "5 minutes ago", "3 days ago". */
export function ago(then: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** The loss line: the time since the newest backup checked in Google Drive, rounded up. */
export function loseLine(lastInDriveAt: Date | null, now: Date) {
  if (!lastInDriveAt) {
    return {
      hours: null,
      line: "If the server is lost now, everything is lost: no backup is safe in Google Drive yet.",
    };
  }
  const hours = Math.max(1, Math.ceil((now.getTime() - lastInDriveAt.getTime()) / 3_600_000));
  return {
    hours,
    line:
      hours === 1
        ? "If the server is lost now, you lose at most 1 hour of work."
        : `If the server is lost now, you lose at most ${hours} hours of work.`,
  };
}

/**
 * The scheduled time that should have a backup by now, when it has none
 * (late). Only once backups have run at all: before the first one, the line
 * says "No backup yet".
 */
async function lateSlot(config: BackupConfig, now: Date, anyBefore: boolean): Promise<Date | null> {
  if (!config.isEnabled || !anyBefore) return null;
  const slot = previousRunAt(
    scheduleOf(config),
    config.timezone,
    new Date(now.getTime() - LATE_AFTER_MS),
  );
  if (!slot) return null;
  const started = await prisma.backupRun.findFirst({
    where: {
      kind: "BACKUP",
      status: { in: ["SUCCEEDED", "RUNNING", "QUEUED"] },
      startedAt: { gte: new Date(slot.getTime() - EARLY_MS) },
    },
    select: { id: true },
  });
  return started ? null : slot;
}

const timeIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);

export async function backupHealth(
  config?: BackupConfig,
  now: Date = new Date(),
): Promise<BackupHealth> {
  config ??= await getBackupConfig();
  const [lastRun, lastSuccess, lastInDrive] = await Promise.all([
    prisma.backupRun.findFirst({
      where: { kind: "BACKUP", status: { in: ["SUCCEEDED", "FAILED"] } },
      orderBy: { startedAt: "desc" },
    }),
    prisma.backupRun.findFirst({
      where: { kind: "BACKUP", status: "SUCCEEDED" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.backupRun.findFirst({
      where: { kind: "BACKUP", status: "SUCCEEDED", checkedAt: { not: null } },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const lose = loseLine(lastInDrive?.startedAt ?? null, now);
  const base = {
    loseAtMostHours: lose.hours,
    loseLine: lose.line,
    lastBackupAt: lastSuccess?.startedAt ?? null,
    lastInDriveAt: lastInDrive?.startedAt ?? null,
  };

  // A restore drill copy (test mode, for good): no backup runs, nothing is sent.
  if (await onDrill()) {
    return { ...base, level: "danger", line: DRILL_LINE, problem: null };
  }
  // A copy on standby after a restore (G2): no backup runs until it goes live.
  if (await onStandby()) {
    return { ...base, level: "danger", line: STANDBY_LINE, problem: null };
  }
  if (lastRun?.status === "FAILED") {
    const text = `The last backup failed ${ago(lastRun.startedAt, now)}: ${lastRun.error ?? "no reason was recorded"}`;
    return { ...base, level: "danger", line: text, problem: { kind: "failed", text } };
  }
  const late = await lateSlot(config, now, Boolean(lastRun));
  if (late) {
    const text = `The backup due at ${timeIn(late, config.timezone)} has not started: is the server running?`;
    return { ...base, level: "danger", line: text, problem: { kind: "late", text } };
  }
  if (!lastSuccess) {
    return {
      ...base,
      level: "danger",
      line: config.isEnabled ? "No backup yet" : "No backup yet, and backups are switched off",
      problem: null,
    };
  }
  const when = ago(lastSuccess.startedAt, now);
  if (lastSuccess.checkedAt) {
    return {
      ...base,
      level: config.isEnabled ? "good" : "warning",
      line: config.isEnabled
        ? `Last backup ${when}, safe in Google Drive`
        : `Last backup ${when}, safe in Google Drive. Backups are switched off.`,
      problem: null,
    };
  }
  const waiting =
    Boolean(config.credentialsRef && lastSuccess.keyId) &&
    now.getTime() - (lastSuccess.finishedAt ?? lastSuccess.startedAt).getTime() >
      NOT_IN_DRIVE_AFTER_MS;
  const line = `Last backup ${when}, on this server only (not in Google Drive)`;
  return {
    ...base,
    level: "warning",
    line,
    problem: waiting
      ? { kind: "not-in-drive", text: `${line}: ${lastSuccess.driveError ?? "it is sent again"}` }
      : null,
  };
}

const SUBJECTS: Record<ProblemKind, string> = {
  failed: "Backup failed",
  late: "Backup is late",
  "not-in-drive": "Backup not in Google Drive",
};

/**
 * Tells the owner about a problem once: the first time it is seen, and again
 * only after the backups worked in between or the problem changed.
 */
export async function raiseProblem(
  kind: ProblemKind,
  subject: string,
  text: string,
  runId?: string,
): Promise<boolean> {
  const config = await getBackupConfig();
  const { count } = await prisma.backupConfig.updateMany({
    where: { id: config.id, OR: [{ alertProblem: null }, { alertProblem: { not: kind } }] },
    data: { alertProblem: kind, alertSentAt: new Date() },
  });
  if (count === 0) return false;
  await alertOwner(subject, text, runId);
  return true;
}

/**
 * Checks the backups (each minute, and after each backup): a new problem is
 * told once; when all is well again after a problem, the owner hears that too.
 */
export async function watchBackups(now: Date = new Date()) {
  const config = await getBackupConfig();
  const health = await backupHealth(config, now);
  if (health.problem) {
    return raiseProblem(health.problem.kind, SUBJECTS[health.problem.kind], health.problem.text);
  }
  if (config.alertProblem && health.level === "good") {
    const { count } = await prisma.backupConfig.updateMany({
      where: { id: config.id, alertProblem: config.alertProblem },
      data: { alertProblem: null, alertSentAt: now },
    });
    if (count === 1) {
      await alertOwner("Backups are working again", `${health.line}. ${health.loseLine}`);
      return true;
    }
  }
  return false;
}
