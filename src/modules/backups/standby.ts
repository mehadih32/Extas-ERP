import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { backupRoot } from "@/modules/backups/backup-core";

/*
 * Standby after a restore on a second server (G2). While the web address still
 * points at the old ERP (a practice run, or the old server still in use), the
 * restore command (deploy/bootstrap.sh) leaves BACKUP_DIR/.standby. This copy
 * then never waits on standby without a word: a bar on every page says so. Its
 * backups and alarms run (a failed backup, Bug Guard's urgent items), so a copy
 * that is used after all is never left without them; its backups are marked as
 * made on standby (Enter never picks one in a restore). Its reminders, messages,
 * Mehedi 2.0's clocks and the housekeeping wait, so two ERPs never send them at
 * once. deploy/go-live.sh takes the mark away once the web address reaches this
 * server; they then run within a minute.
 */

export const STANDBY_MARK = ".standby";

export const STANDBY_LINE =
  "On standby after a restore: the web address does not point to this server yet. Backups and alarms run; reminders and messages wait. When this server is the one to use, run sudo ./deploy/go-live.sh on it.";

const markPath = () => path.join(backupRoot(), STANDBY_MARK);

export async function onStandby(): Promise<boolean> {
  try {
    await access(markPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * The standby mark: since when, and the id /api/health shows while on standby (from
 * the mark's random words), by which deploy/go-live.sh knows the web address reaches
 * this server and not another one. Null when not on standby.
 */
export async function standbyMark(): Promise<{ since: Date; id: string } | null> {
  try {
    const [info, words] = await Promise.all([stat(markPath()), readFile(markPath())]);
    return { since: info.mtime, id: createHash("sha256").update(words).digest("hex").slice(0, 16) };
  } catch {
    return null;
  }
}
