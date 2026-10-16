import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BackupConfig, Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import {
  audit,
  backupRoot,
  driveRoot,
  driveToken,
  getBackupConfig,
  HOST_KEY_FILE,
  reasonFor,
} from "@/modules/backups/backup-core";
import {
  type EarlierKeyPair,
  earlierKeyPairs,
  presentConfig,
} from "@/modules/backups/backup.service";
import { BackupKeyError } from "@/modules/backups/crypt";
import { ensureKeysFile } from "@/modules/backups/drive-copies";
import {
  parseRestoreKeyFile,
  readRootFile,
  removeRootFiles,
  putRootFile,
  restoreKeyFile,
} from "@/modules/backups/drive-root";
import {
  keyStrength,
  makeKeyFile,
  normalizeRecoveryKey,
  openKeyFile,
  parseKeyFile,
  recoveryKeyProblem,
  relockKeyFile,
} from "@/modules/backups/keys";
import { keepKeyInDriveSchema, setRecoveryKeySchema } from "@/modules/backups/schemas";

/*
 * The owner's own recovery key (A9, G4, G5), set on the Backups screen with the
 * PIN. Any word, sentence or pattern of 8 or more characters, typed twice;
 * never made up by the ERP. It makes a key pair: the server keeps the public
 * key (it locks every backup) and the keys file (the private key, locked with
 * the recovery key). The recovery key itself and the open private key are never
 * stored, logged or put in the audit log; they live only for the request.
 *
 * Changing the key keeps the pair (the old key opens the private key, which is
 * locked again with the new one), so every backup still opens. A forgotten key
 * makes a new pair: the screen then says which older backups need the old key.
 * Setting the first key retires v6.3's generated key: backups made before then
 * need its key card.
 *
 * "Keep my recovery key in Google Drive" (on unless the owner turns it off):
 * restore-key.json and the restore guide in the Drive backup folder hold it, so
 * a restore fills it in by itself. Turning it off deletes those copies.
 */

/** The public key for the server, so deploy.sh (on the host) locks deploy/.env with it. */
export async function writeHostKey(config: Pick<BackupConfig, "keyPairId" | "publicKey">) {
  if (!config.keyPairId || !config.publicKey) return;
  const root = backupRoot();
  await mkdir(root, { recursive: true });
  const file = path.join(root, HOST_KEY_FILE);
  await writeFile(
    `${file}.new`,
    JSON.stringify({
      app: "Extas ERP",
      kind: "backup-public-key",
      pairId: config.keyPairId,
      publicKey: config.publicKey,
    }),
    { mode: 0o644 },
  );
  await rename(`${file}.new`, file);
}

const field = (name: string, message: string) =>
  new AppError("VALIDATION", message, { [name]: [message] });

/**
 * Puts the recovery key in Drive (restore-key.json, and the guide with it
 * printed), or takes it out. Returns when it is there now, or null.
 */
async function keyInDrive(
  config: BackupConfig,
  keep: boolean,
  recoveryKey: string | null,
): Promise<{ at: Date | null; problem: string | null }> {
  let token: string | null = null;
  try {
    token = await driveToken(config);
  } catch (error) {
    return { at: null, problem: reasonFor(error) };
  }
  if (!token) {
    return {
      at: null,
      problem: keep
        ? "Google Drive is not connected: connect it, then put the key in Drive from this screen."
        : null,
    };
  }
  try {
    const rootId = await driveRoot(config, token);
    await ensureKeysFile(config, token, rootId);
    if (keep && recoveryKey && config.keyPairId) {
      await putRootFile(
        token,
        rootId,
        "restoreKey",
        restoreKeyFile(config.keyPairId, recoveryKey),
        {
          pairId: config.keyPairId,
        },
      );
    } else {
      await removeRootFiles(token, rootId, "restoreKey");
    }
    const { publishGuide } = await import("@/modules/backups/guide.service");
    await publishGuide(config, { token, rootId, recoveryKey: keep ? recoveryKey : null });
    return { at: keep && recoveryKey ? new Date() : null, problem: null };
  } catch (error) {
    return { at: null, problem: reasonFor(error) };
  }
}

/** The recovery key kept in Drive (restore-key.json), when the owner keeps it there. */
export async function recoveryKeyFromDrive(config: BackupConfig): Promise<string | null> {
  if (!config.keepKeyInDrive || !config.keyPairId) return null;
  const token = await driveToken(config);
  if (!token) return null;
  const found = await readRootFile(token, await driveRoot(config, token), "restoreKey");
  const file = found ? parseRestoreKeyFile(found.data) : null;
  return file && file.pairId === config.keyPairId ? file.recoveryKey : null;
}

export async function setRecoveryKey(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = setRecoveryKeySchema.parse(raw);
  const { requirePin } = await import("@/modules/ai/settings.service");
  await requirePin(ctx, input.pin, "set the backup recovery key");
  const key = normalizeRecoveryKey(input.key);
  const problem = recoveryKeyProblem(key);
  if (problem) throw field("key", problem);
  if (normalizeRecoveryKey(input.confirm) !== key) {
    throw field("confirm", "The two keys are not the same: type the same key twice");
  }
  const config = await getBackupConfig();
  const now = new Date();
  const data: Prisma.BackupConfigUpdateInput = {};
  let summary: string;
  let message: string;

  if (config.lockedKeyFile && config.keyPairId && !input.forgotCurrent) {
    // A change: the same pair, its private key locked with the new key.
    if (!input.currentKey) throw field("currentKey", "Type your current recovery key");
    let relocked;
    try {
      relocked = await relockKeyFile(parseKeyFile(config.lockedKeyFile), input.currentKey, key);
    } catch (error) {
      if (error instanceof BackupKeyError) {
        throw field("currentKey", "That is not your current recovery key");
      }
      throw error;
    }
    data.lockedKeyFile = JSON.stringify(relocked);
    data.keySetAt = now;
    summary = `Changed the backup recovery key (key ${config.keyPairId} stays)`;
    message = "Your new recovery key opens every backup, old and new.";
  } else {
    const file = await makeKeyFile(key, now);
    data.keyPairId = file.pairId;
    data.publicKey = file.publicKey;
    data.lockedKeyFile = JSON.stringify(file);
    data.keySetAt = now;
    if (config.keyPairId) {
      // Forgotten: a new pair; backups up to now need the old key.
      const earlier: EarlierKeyPair[] = [
        ...earlierKeyPairs(config),
        {
          pairId: config.keyPairId,
          setAt: config.keySetAt?.toISOString() ?? null,
          until: now.toISOString(),
        },
      ];
      data.earlierKeyPairs = earlier as unknown as Prisma.InputJsonArray;
      summary = `Set a new backup recovery key (key ${file.pairId}); backups before it need the old key (key ${config.keyPairId})`;
      message = `New backups are locked with your new key. Backups made before now (key ${config.keyPairId}) open only with your old recovery key.`;
    } else if (config.recoveryKeyRef) {
      // v6.3's generated key is retired: it no longer locks new backups.
      data.legacyKeyId = config.recoveryKeyId;
      data.legacyKeyRetiredAt = now;
      data.recoveryKeyRef = null;
      summary = `Set the backup recovery key (key ${file.pairId}); the v6.3 key (${config.recoveryKeyId}) is retired`;
      message = `New backups are locked with your key. Backups made before now open only with the old key card (key ${config.recoveryKeyId}).`;
    } else {
      summary = `Set the backup recovery key (key ${file.pairId})`;
      message = "From now on every backup is locked with your key.";
    }
  }
  if (input.keepInDrive !== undefined) data.keepKeyInDrive = input.keepInDrive;

  let updated = await prisma.backupConfig.update({ where: { id: config.id }, data });
  await writeHostKey(updated);
  const drive = await keyInDrive(updated, updated.keepKeyInDrive, key);
  updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: { keyInDriveAt: drive.at },
  });
  await audit({ userId: ctx.user.id }, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `${summary}${
      updated.keepKeyInDrive
        ? drive.at
          ? "; kept in Google Drive"
          : "; not in Google Drive yet"
        : "; not kept in Google Drive"
    }`,
  });
  return {
    config: presentConfig(updated),
    message,
    strength: keyStrength(key).hint,
    driveProblem: drive.problem,
  };
}

/** "Keep my recovery key in Google Drive": on (the key typed once) or off (Drive's copies go). */
export async function setKeepKeyInDrive(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = keepKeyInDriveSchema.parse(raw);
  const { requirePin } = await import("@/modules/ai/settings.service");
  await requirePin(ctx, input.pin, "change where the recovery key is kept");
  const config = await getBackupConfig();
  if (!config.lockedKeyFile) {
    throw new AppError("CONFLICT", "Set your recovery key first.");
  }
  let key: string | null = null;
  if (input.keep) {
    if (!input.key) throw field("key", "Type your recovery key once to put it in Google Drive");
    try {
      await openKeyFile(parseKeyFile(config.lockedKeyFile), input.key);
    } catch (error) {
      if (error instanceof BackupKeyError) {
        throw field("key", "That is not your recovery key");
      }
      throw error;
    }
    key = normalizeRecoveryKey(input.key);
  }
  const drive = await keyInDrive({ ...config, keepKeyInDrive: input.keep }, input.keep, key);
  if (!input.keep && drive.problem) {
    throw new AppError(
      "UNAVAILABLE",
      `The key could not be taken out of Google Drive: ${drive.problem}`,
    );
  }
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: { keepKeyInDrive: input.keep, keyInDriveAt: drive.at },
  });
  await audit({ userId: ctx.user.id }, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: input.keep
      ? drive.at
        ? "Put the backup recovery key in Google Drive (restore-key.json and the restore guide)"
        : "Chose to keep the backup recovery key in Google Drive (not there yet: Google Drive is not connected)"
      : "Took the backup recovery key out of Google Drive (restore-key.json deleted, the guide made without it)",
  });
  return { config: presentConfig(updated), driveProblem: drive.problem };
}
