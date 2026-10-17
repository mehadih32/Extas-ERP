import { access } from "node:fs/promises";
import path from "node:path";

import { backupRoot } from "@/modules/backups/backup-core";

/*
 * Standby after a restore on a second server (G2). While the web address still
 * points at the old ERP (a practice run, or the old server still in use), the
 * restore command (deploy/bootstrap.sh) leaves BACKUP_DIR/.standby: this copy
 * then runs no clock (no backups, reminders, jobs, Bug Guard schedule or
 * housekeeping), so two ERPs never send reminders or make backups at once. It
 * still opens and can be checked. deploy/go-live.sh takes the mark away once
 * this server is the one to use; the clocks then run within a minute.
 */

export const STANDBY_MARK = ".standby";

export const STANDBY_LINE =
  "On standby after a restore: this copy makes no backups and sends no reminders. When it is the one to use, run sudo ./deploy/go-live.sh on its server.";

export async function onStandby(): Promise<boolean> {
  try {
    await access(path.join(backupRoot(), STANDBY_MARK));
    return true;
  } catch {
    return false;
  }
}
