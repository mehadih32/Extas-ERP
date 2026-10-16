import * as drive from "@/modules/backups/google-drive";

/*
 * The files the ERP keeps directly in the "Extas ERP Backups" folder in Google
 * Drive, beside the backups. Each is labelled (appProperties "extas"), so the
 * ERP finds, replaces and removes only the files it made itself:
 *   backup-keys.json         the keys file (public key; private key locked with
 *                            the owner's recovery key)
 *   restore-key.json         the recovery key itself, only while the owner keeps
 *                            "Keep my recovery key in Google Drive" on (G5)
 *   Extas ERP restore guide (Bangla).pdf / (English).pdf
 *                            the restore guide (G6, G7), with the recovery key
 *                            printed in it while the owner keeps it in Drive
 */

export const ROOT_FILES = {
  keys: { label: "keys", name: "backup-keys.json", mime: "application/json" },
  restoreKey: { label: "restore-key", name: "restore-key.json", mime: "application/json" },
  guideBn: {
    label: "guide-bn",
    name: "Extas ERP restore guide (Bangla).pdf",
    mime: "application/pdf",
  },
  guideEn: {
    label: "guide-en",
    name: "Extas ERP restore guide (English).pdf",
    mime: "application/pdf",
  },
} as const;

export type RootFile = keyof typeof ROOT_FILES;

/**
 * The ERP's own labelled files of one kind in the backups folder, oldest first
 * (a backup's folder is labelled "backup", so it is never one of them).
 */
export async function findRootFiles(token: string, rootId: string, which: RootFile) {
  const { label } = ROOT_FILES[which];
  return (await drive.listFiles(token, rootId)).filter((f) => f.appProperties?.extas === label);
}

/**
 * Puts a file in the backups folder, replacing the ERP's earlier one of the
 * same kind (the new one is uploaded first, then the old ones go).
 */
export async function putRootFile(
  token: string,
  rootId: string,
  which: RootFile,
  data: Buffer,
  labels: Record<string, string> = {},
): Promise<drive.DriveFile> {
  const { label, name, mime } = ROOT_FILES[which];
  const old = await findRootFiles(token, rootId, which);
  const made = await drive.uploadBytes(token, data, rootId, name, mime, {
    ...labels,
    extas: label,
  });
  for (const file of old) await drive.deleteFile(token, file.id);
  return made;
}

/** Removes the ERP's files of one kind from the backups folder; returns how many went. */
export async function removeRootFiles(token: string, rootId: string, which: RootFile) {
  const old = await findRootFiles(token, rootId, which);
  for (const file of old) await drive.deleteFile(token, file.id);
  return old.length;
}

/** The newest of the ERP's files of one kind, read into memory; null when there is none. */
export async function readRootFile(
  token: string,
  rootId: string,
  which: RootFile,
): Promise<{ file: drive.DriveFile; data: Buffer } | null> {
  const files = await findRootFiles(token, rootId, which);
  const newest = files.at(-1);
  if (!newest) return null;
  return { file: newest, data: await drive.downloadBytes(token, newest.id) };
}

/** What restore-key.json holds. */
export type RestoreKeyFile = {
  app: "Extas ERP";
  kind: "restore-key";
  pairId: string;
  recoveryKey: string;
  savedAt: string;
};

export function restoreKeyFile(pairId: string, recoveryKey: string, now = new Date()) {
  const file: RestoreKeyFile = {
    app: "Extas ERP",
    kind: "restore-key",
    pairId,
    recoveryKey,
    savedAt: now.toISOString(),
  };
  return Buffer.from(JSON.stringify(file, null, 2));
}

export function parseRestoreKeyFile(data: Buffer): RestoreKeyFile | null {
  try {
    const file = JSON.parse(data.toString("utf8")) as RestoreKeyFile;
    return file?.kind === "restore-key" && typeof file.recoveryKey === "string" ? file : null;
  } catch {
    return null;
  }
}
