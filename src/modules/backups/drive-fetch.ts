import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ManifestFile } from "@/modules/backups/backup.service";
import type { UploadFile } from "@/modules/backups/contents";
import {
  backupKey,
  BackupKeyError,
  keyId as nameKey,
  type Opener,
  parseRecoveryKey,
  type PrivateKeys,
  unlockFile,
} from "@/modules/backups/crypt";
import * as drive from "@/modules/backups/google-drive";
import { type KeyFile, openKeyFile, parseKeyFile } from "@/modules/backups/keys";

/*
 * Reading backups back from Google Drive: the list, and one backup downloaded,
 * checked and opened with the recovery key. A v6.4 backup (format 3) carries
 * its keys file: the owner's recovery key opens its private key, which opens
 * the files. A v6.3 backup (format 2) opens with v6.3's key (the key card).
 * Used by the drill, the restore from the screen and the scripts; a new
 * server uses deploy/restore-tool.py, which reads the same formats.
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
  /** 3: locked with the owner's key pair (v6.4); 2: v6.3's key; 1: not locked. */
  format: number;
  /** Made by a restored copy while it waited on standby (backup.service.ts). */
  standby: boolean;
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
    // v6.3 labelled no format: its backups were locked with its own key.
    format: labels.format ? Number(labels.format) : 2,
    standby: labels.standby === "yes",
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

/** What server.json holds: the old server's key and the facts a new server needs. */
export type ServerFacts = {
  encryptionKey: string | null;
  appUrl: string | null;
  appDomain?: string | null;
  ownerEmail?: string | null;
  createdAt?: string;
  google?: { clientId: string; clientSecret: string } | null;
  cloudflare?: { zone: string; zoneId: string | null; token: string } | null;
};

export type BackupManifest = {
  format?: number;
  createdAt: string;
  keyId: string | null;
  files: ManifestFile[];
  kind?: string;
  commit?: string | null;
  version?: string | null;
  records?: number;
  tables?: Record<string, number>;
  uploads?: UploadFile[];
  missing?: string[];
};

export type FetchedBackup = {
  dir: string;
  name: string;
  manifest: BackupManifest;
  /** The plain files, opened: database.dump always; the rest when the backup has them. */
  database: string;
  media: string | null;
  code: string | null;
  settings: string | null;
  server: ServerFacts | null;
};

/** The keys a backup may be opened with. */
export type FetchKeys = {
  /** The owner's recovery key (v6.4), or a v6.3 key card typed in. */
  recoveryKey?: string | null;
  /** v6.3's key, as this server kept it. */
  legacy?: Buffer | null;
  /** More keys files to try besides the backup's own (this server's, Drive's). */
  keyFiles?: KeyFile[];
};

/** The private key for a format-3 backup: its keys file opened with the recovery key. */
async function openerFor(
  manifest: BackupManifest,
  ownKeyFile: KeyFile | null,
  keys: FetchKeys,
): Promise<Opener> {
  if (manifest.format === 3) {
    const pairId = manifest.keyId;
    const candidates = [...(ownKeyFile ? [ownKeyFile] : []), ...(keys.keyFiles ?? [])].filter(
      (f) => f.pairId === pairId,
    );
    if (!keys.recoveryKey) {
      throw new BackupKeyError("This backup needs your recovery key to open.");
    }
    if (candidates.length === 0) {
      throw new BackupKeyError(`The keys file for this backup (key ${pairId}) is missing.`);
    }
    const privateKeys: PrivateKeys = new Map();
    for (const file of candidates) {
      try {
        privateKeys.set(file.pairId, await openKeyFile(file, keys.recoveryKey));
        return { privateKeys };
      } catch (error) {
        if (!(error instanceof BackupKeyError)) throw error;
      }
    }
    throw new BackupKeyError("This recovery key is not the one these backups were locked with.");
  }
  let legacy = keys.legacy ?? null;
  if (!legacy && keys.recoveryKey) {
    try {
      legacy = backupKey(parseRecoveryKey(keys.recoveryKey));
    } catch {
      legacy = null;
    }
  }
  if (!legacy) {
    throw new BackupKeyError(
      "This backup was locked with the old (v6.3) recovery key: type the key from the old key card.",
    );
  }
  if (manifest.keyId && manifest.keyId !== nameKey(legacy)) {
    throw new BackupKeyError(
      `This backup was locked with another recovery key (${manifest.keyId}); the key given does not open it.`,
    );
  }
  return legacy;
}

/**
 * Downloads a backup from Drive into `into`, checks every file against the
 * manifest, and opens the locked ones. The locked files are deleted once
 * opened; a failure leaves nothing behind.
 */
export async function fetchBackup(
  token: string,
  folder: { id: string; name: string },
  into: string,
  keys: FetchKeys,
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
    ) as BackupManifest;
    // Every file first, checked; then the key; then the locked files opened.
    const local: Record<string, string> = {};
    for (const entry of manifest.files) {
      if (path.basename(entry.name) !== entry.name || entry.name.startsWith(".")) {
        throw new BackupKeyError("Unexpected file name.");
      }
      const found = files.find((f) => f.name === entry.name);
      if (!found) throw new BackupKeyError(`${entry.name} is missing from this backup in Drive.`);
      const at = path.join(dir, entry.name);
      await drive.downloadFile(token, found.id, at);
      const size = (await stat(at)).size;
      if (size !== entry.bytes) {
        throw new BackupKeyError(
          `${entry.name} did not download whole (${size} of ${entry.bytes} bytes).`,
        );
      }
      local[entry.name] = at;
    }
    const keysPath = local["backup-keys.json"];
    const ownKeyFile = keysPath ? parseKeyFile(await readFile(keysPath, "utf8")) : null;
    const locked = manifest.files.some((f) => f.plain);
    const opener = locked ? await openerFor(manifest, ownKeyFile, keys) : null;
    const opened: Record<string, string> = {};
    for (const entry of manifest.files) {
      if (!entry.plain) {
        opened[entry.name] = local[entry.name]!;
        continue;
      }
      if (path.basename(entry.plain.name) !== entry.plain.name) {
        throw new BackupKeyError("Unexpected file name.");
      }
      const plain = path.join(dir, entry.plain.name);
      const facts = await unlockFile(opener!, local[entry.name]!, plain);
      await rm(local[entry.name]!, { force: true });
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
      code: opened["code.bundle"] ?? null,
      settings: opened["settings.env"] ?? null,
      server,
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The drill without the recovery key: every file of a backup downloaded and
 * checked against the manifest (size and SHA-256 of the locked bytes), then
 * deleted. It proves Google keeps the backup whole, not that it opens.
 */
export async function checkBackupFiles(
  token: string,
  folder: { id: string; name: string },
  into: string,
): Promise<{ manifest: BackupManifest; files: number; bytes: number; problems: string[] }> {
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
    ) as BackupManifest;
    const problems: string[] = [];
    let bytes = 0;
    for (const entry of manifest.files) {
      if (path.basename(entry.name) !== entry.name)
        throw new BackupKeyError("Unexpected file name.");
      const found = files.find((f) => f.name === entry.name);
      if (!found) {
        problems.push(`${entry.name} is missing from this backup in Drive.`);
        continue;
      }
      const at = path.join(dir, entry.name);
      await drive.downloadFile(token, found.id, at);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(at)) hash.update(chunk as Buffer);
      const size = (await stat(at)).size;
      bytes += size;
      if (size !== entry.bytes || hash.digest("hex") !== entry.sha256) {
        problems.push(`${entry.name} in Drive is not the file that was backed up.`);
      }
      await rm(at, { force: true });
    }
    return { manifest, files: manifest.files.length, bytes, problems };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** What restore.sh reads: the database and the files. */
const FOR_RESTORE = ["database.dump", "media.tar.gz"];

/**
 * Rewrites an opened backup's manifest the way restore.sh reads it (format 1:
 * the plain database and files and their checksums, and the counts to compare)
 * and takes everything else out of the folder: the server keeps its own code,
 * settings and keys. Returns the server facts the backup held.
 */
export async function readyForRestore(fetched: FetchedBackup): Promise<ServerFacts | null> {
  const keep = fetched.manifest.files
    .map((f) => f.plain ?? f)
    .filter((f) => FOR_RESTORE.includes(f.name));
  for (const entry of fetched.manifest.files) {
    const name = (entry.plain ?? entry).name;
    if (!FOR_RESTORE.includes(name)) await rm(path.join(fetched.dir, name), { force: true });
  }
  await writeFile(
    path.join(fetched.dir, "manifest.json"),
    JSON.stringify(
      {
        app: "Extas ERP",
        format: 1,
        createdAt: fetched.manifest.createdAt,
        files: keep.map((f) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256 })),
        ...(fetched.manifest.tables ? { tables: fetched.manifest.tables } : {}),
        ...(fetched.manifest.uploads ? { uploads: fetched.manifest.uploads } : {}),
      },
      null,
      2,
    ),
  );
  return fetched.server;
}
