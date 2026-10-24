/*
 * Where a backup started with "Back up now" stands: for the line above the
 * Backups screen (backups-screen.tsx), which reads the page again every few
 * seconds until the run is done, and for the message the person who started it
 * gets when it ends (manual-notice.ts). A run is marked done on the server first
 * and then sent to Google Drive (backup.service.ts, executeRun): it is finished
 * only once Google's copy is checked, or the reason it stays on the server is known.
 */

export type BackupRunState = {
  status: string;
  checkedAt: Date | string | null;
  driveError: string | null;
  error: string | null;
};

export type BackupProgress =
  { done: false; text: string } | { done: true; tone: "success" | "error" | "note"; text: string };

/** How often the screen reads the page again while a backup runs, and for how long at most. */
export const BACKUP_POLL_MS = 10_000;
export const BACKUP_POLL_LIMIT_MS = 30 * 60_000;

export const BACKING_UP =
  "Backing up now. It takes a few minutes; this page shows it when it is done.";

/** A backup's size as people read it ("47.2 MB"). */
export function backupSize(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Why a backup stays on the server, without the "Kept on the server only:" the run saves with it. */
export function serverOnlyReason(driveError: string) {
  const why = driveError.replace(/^Kept on the server only:\s*/, "").trim();
  return why.charAt(0).toUpperCase() + why.slice(1);
}

export function backupProgress(run: BackupRunState): BackupProgress {
  if (run.status === "QUEUED" || run.status === "RUNNING") return { done: false, text: BACKING_UP };
  if (run.status === "FAILED") {
    return {
      done: true,
      tone: "error",
      text: `The backup failed: ${run.error ?? "the reason is in the list of backups below."}`,
    };
  }
  if (run.checkedAt) {
    return { done: true, tone: "success", text: "The backup is done and safe in Google Drive." };
  }
  if (run.driveError) {
    return {
      done: true,
      tone: "note",
      text: `The backup is done, on this server only. ${serverOnlyReason(run.driveError)}`,
    };
  }
  return {
    done: false,
    text: "The backup is made on this server; it is going to Google Drive now.",
  };
}

/**
 * The message for the person who pressed "Back up now", once the backup has
 * ended (null while it still runs).
 */
export function backupDoneNotice(
  run: BackupRunState & { sizeBytes: number | bigint | null },
): { subject: string; text: string } | null {
  const progress = backupProgress(run);
  if (!progress.done) return null;
  if (progress.tone === "error") {
    return {
      subject: "Backup failed",
      text: `Backup failed: ${run.error ?? "the reason is on the Backups screen."}`,
    };
  }
  const bytes = run.sizeBytes === null ? null : Number(run.sizeBytes);
  const sized = bytes ? ` (${backupSize(bytes)})` : "";
  if (progress.tone === "success") {
    return { subject: "Backup done", text: `Backup done: safe in Google Drive${sized}.` };
  }
  return {
    subject: "Backup done, on this server only",
    text: `Backup done, on this server only${sized}: ${serverOnlyReason(run.driveError ?? "")}`,
  };
}
