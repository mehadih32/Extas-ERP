import { createHmac } from "node:crypto";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import {
  alertOwner,
  audit,
  backupRoot,
  currentKey,
  driveToken,
  getBackupConfig,
  reasonFor,
} from "@/modules/backups/backup-core";
import { claimRun } from "@/modules/backups/backup.service";
import { BackupKeyError } from "@/modules/backups/crypt";
import { fetchBackup, listDriveBackups } from "@/modules/backups/drive-copies";
import { readyForRestore } from "@/modules/backups/drive-fetch";
import { parseKeyFile } from "@/modules/backups/keys";
import { recoveryKeyFromDrive } from "@/modules/backups/recovery-key.service";
import { restoreRequestSchema } from "@/modules/backups/schemas";

/*
 * Restore from the Backups screen. The ERP cannot replace its own database while
 * it runs, so it does the part it can and hands the rest to the server:
 *   1. the owner picks a backup in Drive, gives the PIN and types RESTORE;
 *   2. the ERP downloads it, checks every file and opens it with the recovery
 *      key (kept in Google Drive, or typed with the PIN; a v6.3 backup with its
 *      key card) into BACKUP_DIR/restores/<name>, and leaves a signed request;
 *   3. on the server, deploy/restore-request.sh (started by systemd when the
 *      request appears; deploy.sh installs it) runs deploy/restore.sh: a safety
 *      copy of the database first, then the restore, then the full check of
 *      every screen, and goes back to the safety copy when the ERP does not start;
 *   4. its result file is read when the ERP is back, recorded and sent to the owner.
 */

/** Written by deploy.sh when the server's restore helper is installed. */
const WATCHER_MARK = ".restore-helper";
const REQUEST = "restore-request.json";
const RESULT = "restore-result.json";
/**
 * A restore cut off half-way, settled later by the server (deploy/lib.sh
 * settle_cut_restore): always NOT done, in a file of its own, so the restore that
 * may run next never writes over it.
 */
const CUT_RESULT = /^restore-cut-[\w-]+\.json$/;
const STATUS = "restore-status.json";

/** Whether this server can restore from the screen (deploy.sh installed its helper). */
export async function restoreHelperReady(): Promise<boolean> {
  return stat(path.join(backupRoot(), WATCHER_MARK)).then(
    () => true,
    () => false,
  );
}

function sign(folder: string, requestedAt: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new AppError("UNAVAILABLE", "The server has no ENCRYPTION_KEY.");
  return createHmac("sha256", key).update(`${folder}|${requestedAt}`).digest("hex");
}

/** What the server is doing with a restore, for the screen. */
export async function restoreStatus() {
  const root = backupRoot();
  const read = async (name: string) => {
    try {
      return JSON.parse(await readFile(path.join(root, name), "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const [request, status] = await Promise.all([read(REQUEST), read(STATUS)]);
  return {
    helperReady: await restoreHelperReady(),
    waiting: request ? { name: request.name, requestedAt: request.requestedAt } : null,
    status,
  };
}

/** Step 1-2: the owner's restore, prepared and handed to the server. */
export async function requestRestore(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  if (!ctx.user.isSuperAdmin)
    throw new AppError("FORBIDDEN", "Only the platform owner can restore.");
  const input = restoreRequestSchema.parse(raw);
  if (input.confirm !== "RESTORE") {
    throw new AppError("VALIDATION", "Type RESTORE in capitals to go ahead.", {
      confirm: ["Type RESTORE in capitals"],
    });
  }
  const { requirePin } = await import("@/modules/ai/settings.service");
  await requirePin(ctx, input.pin, "restore a backup");
  if (!(await restoreHelperReady())) {
    throw new AppError(
      "UNAVAILABLE",
      "This server cannot restore from the screen yet: the next update (deploy.sh) installs its restore helper. Until then, restore with deploy/restore.sh.",
    );
  }
  const root = backupRoot();
  if ((await restoreStatus()).waiting) {
    throw new AppError("CONFLICT", "A restore is already waiting for the server.");
  }
  const config = await getBackupConfig();
  const token = await driveToken(config);
  if (!token) throw new AppError("CONFLICT", "Connect Google Drive first.");
  const backup = (await listDriveBackups()).items.find((b) => b.folderId === input.folderId);
  if (!backup) throw new AppError("NOT_FOUND", "That backup is not in Google Drive any more.");
  if (!backup.checked) {
    throw new AppError("CONFLICT", "That backup was never checked in Drive; pick a checked one.");
  }

  const run = await claimRun("MANUAL", { userId: ctx.user.id }, "RESTORE", backup.name);
  await audit({ userId: ctx.user.id }, meta, {
    action: "CREATE",
    entityType: "BackupRun",
    entityId: run.id,
    summary: `Asked to restore the backup ${backup.name} (PIN given, RESTORE typed)`,
  });
  try {
    // The key typed on the screen, else the one kept in Drive; v6.3's for its own backups.
    const recoveryKey =
      input.key?.trim() || (await recoveryKeyFromDrive(config).catch(() => null)) || null;
    const fetched = await fetchBackup(
      token,
      { id: backup.folderId, name: backup.name },
      path.join(root, "restores"),
      {
        recoveryKey,
        legacy: currentKey(config)?.key ?? null,
        keyFiles: config.lockedKeyFile ? [parseKeyFile(config.lockedKeyFile)] : [],
      },
    );
    // restore.sh checks the plain files against this manifest; this server keeps its own key.
    await readyForRestore(fetched);
    const folder = path.relative(root, fetched.dir);
    const requestedAt = new Date().toISOString();
    await writeFile(
      path.join(root, REQUEST),
      JSON.stringify({
        folder,
        name: backup.name,
        requestedAt,
        requestedBy: ctx.user.email,
        signature: sign(folder, requestedAt),
      }),
    );
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        sourceName: backup.name,
        report: { stage: "handed to the server", folder } as Prisma.InputJsonObject,
      },
    });
    return { name: backup.name, requestedAt };
  } catch (error) {
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: reasonFor(error),
        sourceName: backup.name,
      },
    });
    if (error instanceof BackupKeyError) {
      throw new AppError("VALIDATION", error.message, { key: [error.message] });
    }
    throw error instanceof AppError ? error : new AppError("UNAVAILABLE", reasonFor(error));
  }
}

type RestoreResult = {
  ok: boolean;
  name?: string;
  folder?: string;
  startedAt?: string;
  finishedAt?: string;
  safetyCopy?: string;
  wentBack?: boolean;
  message?: string;
  checks?: string[];
};

/**
 * Step 4: records the server's result once the ERP is back (the database now
 * is the backup's, so the restore's own record is made here, afterwards), and
 * the note of any restore cut off half-way before it. True when one was recorded.
 */
export async function recordRestoreResult(): Promise<boolean> {
  const root = backupRoot();
  const cut = (await readdir(root).catch(() => [] as string[]))
    .filter((name) => CUT_RESULT.test(name))
    .sort();
  let recorded = false;
  for (const name of [...cut, RESULT]) {
    if (await recordResultFile(root, name)) recorded = true;
  }
  return recorded;
}

async function recordResultFile(root: string, name: string): Promise<boolean> {
  const file = path.join(root, name);
  let result: RestoreResult;
  try {
    result = JSON.parse(await readFile(file, "utf8")) as RestoreResult;
  } catch {
    return false;
  }
  // Taken once, even if recording fails below.
  await rename(
    file,
    path.join(root, `${name.replace(/\.json$/, "")}-${Date.now()}.done.json`),
  ).catch(() => undefined);
  await rm(path.join(root, STATUS), { force: true });
  const run = await prisma.backupRun.create({
    data: {
      trigger: "MANUAL",
      kind: "RESTORE",
      name: result.name ?? null,
      sourceName: result.name ?? null,
      status: result.ok ? "SUCCEEDED" : "FAILED",
      startedAt: result.startedAt ? new Date(result.startedAt) : new Date(),
      finishedAt: result.finishedAt ? new Date(result.finishedAt) : new Date(),
      error: result.ok ? null : (result.message ?? "The restore did not finish."),
      report: result as unknown as Prisma.InputJsonObject,
    },
  });
  await alertOwner(
    result.ok ? "Restore finished" : "Restore did not finish",
    result.ok
      ? `The ${result.name} backup is back and every screen was checked${result.checks?.length ? ` (${result.checks.length} problem(s) noted)` : ""}. This server's recovery key, backup schedule and Google Drive stay as they were. To undo it, restore the safety copy ${result.safetyCopy ?? ""}: that puts back the database only; the uploaded files from before the restore stay on the server for 30 days.`
      : `${result.message ?? "The restore did not finish."}${result.wentBack ? " The ERP was put back as it was before (the safety copy)." : ""}`,
    run.id,
  );
  return true;
}
