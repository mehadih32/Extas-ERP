import { AppError } from "@/lib/errors";
import { driveToken, getBackupConfig } from "@/modules/backups/backup-core";
import * as drive from "@/modules/backups/google-drive";

/*
 * The live state of the Google Drive connection, for the Backups screen's Google
 * Drive panel. It only asks Google (a fresh access token, then the Drive's space)
 * and changes nothing: no backup, label or setting. When Google ended the access
 * (removed at myaccount.google.com, or run out), the panel asks to Reconnect; the
 * backups meanwhile stay on the server and go to Drive within the hour after it.
 */

export type DriveStatus =
  | { state: "none" }
  | { state: "connected"; freeBytes: number | null; totalBytes: number | null }
  | { state: "reconnect" }
  | { state: "unreachable" };

export async function driveStatus(): Promise<DriveStatus> {
  const config = await getBackupConfig();
  let token: string | null;
  try {
    token = await driveToken(config);
  } catch (error) {
    // A restore drill copy never uses Google Drive.
    if (error instanceof AppError) return { state: "none" };
    if (error instanceof drive.DriveError && error.reconnect) return { state: "reconnect" };
    return { state: "unreachable" };
  }
  if (!token) return { state: "none" };
  try {
    return { state: "connected", ...(await drive.storageQuota(token)) };
  } catch (error) {
    if (error instanceof drive.DriveError && error.reconnect) return { state: "reconnect" };
    // Signed in, but the space could not be read: still connected.
    return { state: "connected", freeBytes: null, totalBytes: null };
  }
}
