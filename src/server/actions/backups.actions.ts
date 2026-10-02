"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";

/*
 * Backup Server Actions. A backup holds every company's data, so all of them are
 * for the platform owner only. Downloads and the Google sign-in return address
 * are plain HTTP routes (/api/backups/...).
 */

const owner = async () => {
  const { user } = await requirePlatformSuperAdmin();
  return { userId: user.id };
};

export const getBackupOverviewAction = async () =>
  runAction(async () => {
    await owner();
    return backups.getBackupOverview();
  });
export const updateBackupConfigAction = async (input: unknown) =>
  runAction(async () => backups.updateBackupConfig(await owner(), input, await getRequestMeta()));
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
  runAction(async () =>
    backups.runBackup({ trigger: "MANUAL", actor: await owner() }, await getRequestMeta()),
  );
/** The Google consent page to open; Google then returns to /api/backups/google/callback. */
export const connectGoogleDriveAction = async () =>
  runAction(async () => backups.googleConnectUrl(await owner()));
export const disconnectGoogleDriveAction = async () =>
  runAction(async () => backups.disconnectGoogleDrive(await owner(), await getRequestMeta()));
