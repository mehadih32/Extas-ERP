import * as drive from "@/modules/backups/google-drive";

/*
 * The files the ERP keeps directly in the "Extas ERP Backups" folder in Google
 * Drive, beside the backups. Each is labelled (appProperties "extas"), so the
 * ERP finds, replaces and removes only the files it made itself:
 *   backup-keys.json         the keys file (public key; private key locked with
 *                            the owner's recovery key)
 *   restore-key.json         the recovery key itself, only while the owner keeps
 *                            "Keep my recovery key in Google Drive" on (G5): one
 *                            per key pair, so after "I forgot my current key" the
 *                            old pair's copy still opens the older backups
 *   Extas ERP restore guide (Bangla).pdf / (English).pdf
 *                            the restore guide (G6, G7), with the recovery key
 *                            printed in it while the owner keeps it in Drive
 *   restore.sh, restore-tool.py
 *                            the restore command and its tool of the running
 *                            version (G17): a restore needs nothing from GitHub
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
  restoreScript: { label: "restore-script", name: "restore.sh", mime: "text/plain" },
  restoreTool: { label: "restore-tool", name: "restore-tool.py", mime: "text/plain" },
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
 * Puts a file in the backups folder, replacing the ERP's earlier ones of the
 * same kind (the new one is uploaded first, then the old ones go). `replaces`
 * picks which earlier ones go, when not all of them (restore-key.json: only
 * the copies of this key pair and of pairs no backup needs any more).
 */
export async function putRootFile(
  token: string,
  rootId: string,
  which: RootFile,
  data: Buffer,
  labels: Record<string, string> = {},
  replaces: (file: drive.DriveFile) => boolean = () => true,
): Promise<drive.DriveFile> {
  const { label, name, mime } = ROOT_FILES[which];
  const old = (await findRootFiles(token, rootId, which)).filter(replaces);
  const made = await drive.uploadBytes(token, data, rootId, name, mime, {
    ...labels,
    extas: label,
  });
  for (const file of old) if (file.id !== made.id) await drive.deleteFile(token, file.id);
  return made;
}

/** Removes the ERP's files of one kind from the backups folder; returns how many went. */
export async function removeRootFiles(token: string, rootId: string, which: RootFile) {
  const old = await findRootFiles(token, rootId, which);
  for (const file of old) await drive.deleteFile(token, file.id);
  return old.length;
}

/**
 * The newest of the ERP's files of one kind (by the time Drive made it), or of
 * those `match` picks, read into memory; null when there is none.
 */
export async function readRootFile(
  token: string,
  rootId: string,
  which: RootFile,
  match: (file: drive.DriveFile) => boolean = () => true,
): Promise<{ file: drive.DriveFile; data: Buffer } | null> {
  const newest = newestFirst((await findRootFiles(token, rootId, which)).filter(match))[0];
  if (!newest) return null;
  return { file: newest, data: await drive.downloadBytes(token, newest.id) };
}

/** Files newest first, by the time Drive made them (as listed when they tie). */
export function newestFirst(files: drive.DriveFile[]): drive.DriveFile[] {
  return files
    .map((file, at) => ({ file, at, time: Date.parse(file.createdTime ?? "") || 0 }))
    .sort((a, b) => b.time - a.time || b.at - a.at)
    .map((f) => f.file);
}

/** The restore-key.json copies of one key pair (each is labelled with its pair). */
export const ofPair = (pairId: string) => (file: drive.DriveFile) =>
  file.appProperties?.pairId === pairId;

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
