import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ManifestFile } from "@/modules/backups/backup.service";
import { BackupKeyError, unlockFile } from "@/modules/backups/crypt";
import * as drive from "@/modules/backups/google-drive";

/*
 * Reading backups back from Google Drive: the list, and one backup downloaded,
 * checked and opened with the recovery key. It needs no database, so a new
 * server uses it too (scripts/drive-restore.ts) before the ERP runs there.
 */

/** The label on the "Extas ERP Backups" folder, so it is found again whatever its name. */
export const ROOT_LABEL = { key: "extas", value: "backups" } as const;

export type DriveBackup = {
  folderId: string;
  name: string;
  kind: "BACKUP" | "SAFETY_COPY";
  createdAt: string;
  bytes: number | null;
  /** Every file was checked against the server's copy after the upload. */
  checked: boolean;
  keyId: string | null;
};

export function presentBackup(folder: drive.DriveFile): DriveBackup {
  const labels = folder.appProperties ?? {};
  return {
    folderId: folder.id,
    name: folder.name,
    kind: labels.kind === "SAFETY_COPY" ? "SAFETY_COPY" : "BACKUP",
    createdAt: labels.createdAt ?? folder.createdTime ?? "",
    bytes: labels.bytes ? Number(labels.bytes) : null,
    checked: labels.checked === "yes",
    keyId: labels.keyId ?? null,
  };
}

/** The backups and safety copies in the backups folder, newest first. */
export async function listBackupFolders(token: string, rootId: string): Promise<DriveBackup[]> {
  return (await drive.listFolders(token, rootId))
    .filter((f) => f.appProperties?.extas === "backup")
    .map(presentBackup)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** Every backups folder this Google sign-in can see (usually one). */
export async function findBackupRoots(token: string) {
  return drive.findFolders(token, ROOT_LABEL.key, ROOT_LABEL.value);
}

/** What server.json holds: the old server's key, so the sealed settings open on a new one. */
export type ServerFacts = {
  encryptionKey: string | null;
  appUrl: string | null;
  ownerEmail?: string | null;
  createdAt?: string;
};

export type FetchedBackup = {
  dir: string;
  name: string;
  manifest: { createdAt: string; keyId: string | null; files: ManifestFile[]; kind?: string };
  /** The plain files, opened: database.dump, and media.tar.gz / server.json when the backup has them. */
  database: string;
  media: string | null;
  server: ServerFacts | null;
};

/**
 * Downloads a backup from Drive into `into`, checks every file against the
 * manifest, and opens the locked ones with `key`. The locked files are deleted
 * once opened; a failure leaves nothing behind.
 */
export async function fetchBackup(
  token: string,
  folder: { id: string; name: string },
  into: string,
  key: { key: Buffer; id: string },
): Promise<FetchedBackup> {
  if (path.basename(folder.name) !== folder.name || folder.name.startsWith(".")) {
    throw new BackupKeyError("Unexpected backup name.");
  }
  const dir = path.join(into, folder.name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    const files = await drive.listFiles(token, folder.id);
    const manifestFile = files.find((f) => f.name === "manifest.json");
    if (!manifestFile) throw new BackupKeyError("This backup has no manifest.json in Drive.");
    await drive.downloadFile(token, manifestFile.id, path.join(dir, "manifest.json"));
    const manifest = JSON.parse(
      await readFile(path.join(dir, "manifest.json"), "utf8"),
    ) as FetchedBackup["manifest"];
    if (manifest.keyId && manifest.keyId !== key.id) {
      throw new BackupKeyError(
        `This backup was locked with another recovery key (${manifest.keyId}); the key given is ${key.id}.`,
      );
    }
    const opened: Record<string, string> = {};
    for (const entry of manifest.files) {
      if (path.basename(entry.name) !== entry.name)
        throw new BackupKeyError("Unexpected file name.");
      const found = files.find((f) => f.name === entry.name);
      if (!found) throw new BackupKeyError(`${entry.name} is missing from this backup in Drive.`);
      const local = path.join(dir, entry.name);
      await drive.downloadFile(token, found.id, local);
      const size = (await stat(local)).size;
      if (size !== entry.bytes) {
        throw new BackupKeyError(
          `${entry.name} did not download whole (${size} of ${entry.bytes} bytes).`,
        );
      }
      if (!entry.plain) {
        opened[entry.name] = local;
        continue;
      }
      if (path.basename(entry.plain.name) !== entry.plain.name) {
        throw new BackupKeyError("Unexpected file name.");
      }
      const plain = path.join(dir, entry.plain.name);
      const facts = await unlockFile(key.key, local, plain);
      await rm(local, { force: true });
      if (facts.sha256 !== entry.plain.sha256) {
        throw new BackupKeyError(`${entry.plain.name} does not match its checksum after opening.`);
      }
      opened[entry.plain.name] = plain;
    }
    if (!opened["database.dump"]) throw new BackupKeyError("This backup has no database.");
    let server: ServerFacts | null = null;
    if (opened["server.json"]) {
      server = JSON.parse(await readFile(opened["server.json"], "utf8")) as ServerFacts;
    }
    return {
      dir,
      name: folder.name,
      manifest,
      database: opened["database.dump"],
      media: opened["media.tar.gz"] ?? null,
      server,
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Rewrites an opened backup's manifest the way restore.sh reads it (format 1:
 * the plain files and their checksums) and takes server.json out of the folder.
 * Returns the server facts it held.
 */
export async function readyForRestore(fetched: FetchedBackup): Promise<ServerFacts | null> {
  await rm(path.join(fetched.dir, "server.json"), { force: true });
  await writeFile(
    path.join(fetched.dir, "manifest.json"),
    JSON.stringify(
      {
        app: "Extas ERP",
        format: 1,
        createdAt: fetched.manifest.createdAt,
        files: fetched.manifest.files
          .filter((f) => f.plain && f.plain.name !== "server.json")
          .map((f) => f.plain),
      },
      null,
      2,
    ),
  );
  return fetched.server;
}
