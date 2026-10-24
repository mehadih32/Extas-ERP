import { AppError } from "@/lib/errors";
import { driveToken, getBackupConfig } from "@/modules/backups/backup-core";
import * as drive from "@/modules/backups/google-drive";
import { onDrill } from "@/modules/backups/standby";

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
  // A restore drill copy never uses Google Drive.
  if (await onDrill()) return { state: "none" };
  const config = await getBackupConfig();
  if (!config.credentialsRef) return { state: "none" };
  let token: string | null;
  try {
    token = await driveToken(config);
  } catch (error) {
    // The sign-in cannot be opened (the server's ENCRYPTION_KEY changed) or Google
    // ended it: only a new Connect helps.
    if (error instanceof AppError) return { state: "reconnect" };
    if (error instanceof drive.DriveError && error.reconnect) return { state: "reconnect" };
    // Google's sign-in refused this client (401: the sign-in was made with another
    // client, as after deploy/set-google-client.sh, or the client is gone).
    if (error instanceof drive.DriveError && error.status === 401) return { state: "reconnect" };
    return { state: "unreachable" };
  }
  // Signed in, but no Google client to use it with any more.
  if (!token) return { state: "reconnect" };
  try {
    return { state: "connected", ...(await drive.storageQuota(token)) };
  } catch (error) {
    if (error instanceof drive.DriveError && error.reconnect) return { state: "reconnect" };
    // Signed in, but the space could not be read: still connected.
    return { state: "connected", freeBytes: null, totalBytes: null };
  }
}
