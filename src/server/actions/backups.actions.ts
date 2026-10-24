"use server";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany, requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";
import * as cloudflare from "@/modules/backups/cloudflare";
import { setUpGitHubAlert } from "@/modules/backups/github-alert";
import { startDriveConnect } from "@/modules/backups/drive-connect";
import { listDriveBackups } from "@/modules/backups/drive-copies";
import { driveStatus } from "@/modules/backups/drive-status";
import * as keys from "@/modules/backups/recovery-key.service";
import * as restores from "@/modules/backups/restore.service";
import { drillNowSchema } from "@/modules/backups/schemas";
import { recordServerDrill } from "@/modules/backups/server-drill";
import { runTestRestore } from "@/modules/backups/test-restore";

/*
 * Backup Server Actions (Settings > Backups). A backup holds every company's
 * data, so all of them are for the platform owner only. Downloads are plain
 * HTTP routes (/api/backups/...). The recovery key, the Cloudflare token,
 * Restore, and making the backups less safe (switching them off, fewer days in
 * Drive, disconnecting Drive, connecting it again over a sign-in) also need the
 * company's PIN, so they run in the company the owner is working in.
 */

const owner = async () => {
  const { user } = await requirePlatformSuperAdmin();
  return { userId: user.id };
};

/** The owner, in the company they are working in (for the PIN). */
const ownerInCompany = async () => {
  const ctx = await requireCompany();
  if (!ctx.user.isSuperAdmin)
    throw new AppError("FORBIDDEN", "Only the platform owner can do this.");
  return ctx;
};

const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const out = await work();
    revalidatePath("/settings/backups");
    return out;
  });

export const getBackupOverviewAction = async () =>
  runAction(async () => {
    await owner();
    return backups.getBackupOverview();
  });
/** Switching backups off or keeping them in Drive for fewer days also needs the PIN. */
export const updateBackupConfigAction = async (input: unknown) =>
  change(async () =>
    backups.updateBackupConfig(await ownerInCompany(), input, await getRequestMeta()),
  );
export const listBackupRunsAction = async (query: unknown) =>
  runAction(async () => {
    await owner();
    return backups.listBackupRuns(query);
  });
export const getBackupRunAction = async (runId: string) =>
  runAction(async () => {
    await owner();
    return backups.getBackupRun(runId);
  });
/** Starts a backup now; it keeps running after this returns (poll the run for its result). */
export const runBackupNowAction = async () =>
  change(async () =>
    backups.runBackup({ trigger: "MANUAL", actor: await owner() }, await getRequestMeta()),
  );
/**
 * Starts the restore drill into a temporary database now. The recovery key may
 * be typed for this drill only (it is never kept).
 */
export const testRestoreNowAction = async (input: unknown = {}) =>
  change(async () => {
    const { key } = drillNowSchema.parse(input ?? {});
    return runTestRestore(
      { trigger: "MANUAL", actor: await owner(), recoveryKey: key?.trim() || null },
      await getRequestMeta(),
    );
  });
/**
 * "Record a drill": reads the time and result of a restore drill on a new server
 * from the drill copy's web address, and keeps it as the last new-server drill.
 */
export const recordServerDrillAction = async (input: unknown) =>
  change(async () => recordServerDrill(await owner(), input, await getRequestMeta()));
/** The backups in Google Drive, newest first. */
export const listDriveBackupsAction = async () =>
  runAction(async () => {
    await owner();
    return listDriveBackups();
  });

// Google Drive
/** The owner's own Google client instead of the server's; needs the PIN. */
export const setGoogleClientAction = async (input: unknown) =>
  change(async () =>
    backups.setGoogleClient(await ownerInCompany(), input, await getRequestMeta()),
  );
/** The Drive panel's live state: connected (with the free space), Reconnect, or not reached. */
export const driveStatusAction = async () =>
  runAction(async () => {
    await owner();
    return driveStatus();
  });
/** A code for the owner's phone (google.com/device). */
/** A new sign-in while Drive is connected (Reconnect, another account) needs the PIN. */
export const startGoogleSignInAction = async (input?: unknown) =>
  change(async () => startDriveConnect(await ownerInCompany(), input, await getRequestMeta()));
/** Whether the owner said yes on their phone; connects Drive when they did. */
export const checkGoogleSignInAction = async () =>
  change(async () => backups.checkGoogleSignIn(await owner(), await getRequestMeta()));
/** Needs the PIN: new backups then stay on the server only. */
export const disconnectGoogleDriveAction = async (input: unknown) =>
  change(async () =>
    backups.disconnectGoogleDrive(await ownerInCompany(), input, await getRequestMeta()),
  );

// The recovery key (set by the owner, with the PIN)
/** Sets or changes the owner's own recovery key; it is never stored or shown again. */
export const setRecoveryKeyAction = async (input: unknown) =>
  change(async () => keys.setRecoveryKey(await ownerInCompany(), input, await getRequestMeta()));
/** "Keep my recovery key in Google Drive": on (the key typed once) or off. */
export const setKeepKeyInDriveAction = async (input: unknown) =>
  change(async () => keys.setKeepKeyInDrive(await ownerInCompany(), input, await getRequestMeta()));

// The late-backup alert on GitHub (A13)
/**
 * Sends the alert's settings to the repository's secrets (with the PIN and a
 * GitHub token for this one step, never kept); the values are never shown.
 */
export const setUpGitHubAlertAction = async (input: unknown) =>
  change(async () => setUpGitHubAlert(await ownerInCompany(), input, await getRequestMeta()));

// Cloudflare (for a new server's DNS and HTTPS)
export const setCloudflareAction = async (input: unknown) =>
  change(async () =>
    cloudflare.setCloudflare(await ownerInCompany(), input, await getRequestMeta()),
  );
export const testCloudflareAction = async () =>
  change(async () => cloudflare.testCloudflare(await owner(), await getRequestMeta()));
export const clearCloudflareAction = async (input: unknown) =>
  change(async () =>
    cloudflare.clearCloudflare(await ownerInCompany(), input, await getRequestMeta()),
  );

// Restore
/** Downloads, checks and opens the backup, then hands it to the server to restore. */
export const requestRestoreAction = async (input: unknown) =>
  change(async () =>
    restores.requestRestore(await ownerInCompany(), input, await getRequestMeta()),
  );
export const restoreStatusAction = async () =>
  runAction(async () => {
    await owner();
    return restores.restoreStatus();
  });
