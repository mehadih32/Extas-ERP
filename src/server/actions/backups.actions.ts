"use server";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany, requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";
import { listDriveBackups } from "@/modules/backups/drive-copies";
import * as restores from "@/modules/backups/restore.service";
import { runTestRestore } from "@/modules/backups/test-restore";

/*
 * Backup Server Actions (Settings > Backups). A backup holds every company's
 * data, so all of them are for the platform owner only. Downloads are plain
 * HTTP routes (/api/backups/...). The recovery key and Restore also need the
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
export const updateBackupConfigAction = async (input: unknown) =>
  change(async () => backups.updateBackupConfig(await owner(), input, await getRequestMeta()));
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
/** Starts the test restore into a temporary database now. */
export const testRestoreNowAction = async () =>
  change(async () =>
    runTestRestore({ trigger: "MANUAL", actor: await owner() }, await getRequestMeta()),
  );
/** The backups in Google Drive, newest first. */
export const listDriveBackupsAction = async () =>
  runAction(async () => {
    await owner();
    return listDriveBackups();
  });

// Google Drive
export const setGoogleClientAction = async (input: unknown) =>
  change(async () => backups.setGoogleClient(await owner(), input, await getRequestMeta()));
/** A code for the owner's phone (google.com/device). */
export const startGoogleSignInAction = async () =>
  change(async () => backups.startGoogleSignIn(await owner(), await getRequestMeta()));
/** Whether the owner said yes on their phone; connects Drive when they did. */
export const checkGoogleSignInAction = async () =>
  change(async () => backups.checkGoogleSignIn(await owner(), await getRequestMeta()));
export const disconnectGoogleDriveAction = async () =>
  change(async () => backups.disconnectGoogleDrive(await owner(), await getRequestMeta()));

// The recovery key
/** Makes the recovery key and returns it this once (a new one needs the PIN). */
export const makeRecoveryKeyAction = async (input: unknown) =>
  change(async () =>
    backups.makeRecoveryKey(await ownerInCompany(), input, await getRequestMeta()),
  );
export const confirmRecoveryKeyAction = async (input: unknown) =>
  change(async () => backups.confirmRecoveryKey(await owner(), input, await getRequestMeta()));

// A new server
export const showRestoreCommandAction = async () =>
  runAction(async () => backups.showRestoreCommand(await owner(), await getRequestMeta()));

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
