import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
} from "node:crypto";

import { BackupKeyError, privateKeyObject, type PublicKey, rawKey } from "@/modules/backups/crypt";
import { normalizeRecoveryKey, recoveryKeyProblem } from "@/modules/backups/key-words";

export {
  keyStrength,
  type KeyStrength,
  normalizeRecoveryKey,
  RECOVERY_KEY_MAX,
  RECOVERY_KEY_MIN,
  recoveryKeyProblem,
} from "@/modules/backups/key-words";

/*
 * The owner's own recovery key (A9, G4). The owner sets it on the Backups
 * screen: any word, sentence or pattern of at least 6 characters (a gentle
 * warning under 10, never a block), never made up by the ERP. Setting it makes a key pair (X25519): the public key locks every
 * backup (crypt.ts), and the private key, which opens them, is kept only locked
 * with a key made from the recovery key by scrypt (N = 2^17, r = 8, p = 1: about
 * 128 MB and half a second for each try, so guessing is slow), in a small keys
 * file. The server stores the public key and the keys file, never the recovery
 * key and never the open private key. The keys file goes into every backup and
 * into the Drive backup folder, so a new server needs only the recovery key.
 */

export const SCRYPT = { N: 1 << 17, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

export type KeyFile = {
  app: "Extas ERP";
  kind: "backup-keys";
  version: 1;
  /** The key pair's id (8 letters and digits), written on each backup it locks. */
  pairId: string;
  /** The public key, raw X25519 (base64url). */
  publicKey: string;
  createdAt: string;
  /** The private key (raw, 32 bytes), locked with AES-256-GCM under scrypt of the recovery key. */
  lockedPrivateKey: {
    kdf: "scrypt";
    N: number;
    r: number;
    p: number;
    salt: string;
    iv: string;
    tag: string;
    data: string;
  };
};

/** A key pair's id from its public key (it reveals nothing of either key). */
export function pairIdOf(publicRaw: Buffer): string {
  return createHash("sha256")
    .update("extas-erp backup key pair")
    .update(publicRaw)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
}

function scrypt(password: string, salt: Buffer, params: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    const options: ScryptOptions = {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: SCRYPT_MAXMEM,
    };
    scryptCallback(Buffer.from(password, "utf8"), salt, 32, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** What the locked private key is bound to, so a keys file cannot be pieced together. */
const bound = (pairId: string, publicKey: string) =>
  Buffer.from(`extas-erp backup keys v1|${pairId}|${publicKey}`, "utf8");

async function lockPrivate(
  d: Buffer,
  recoveryKey: string,
  pairId: string,
  publicKey: string,
): Promise<KeyFile["lockedPrivateKey"]> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scrypt(normalizeRecoveryKey(recoveryKey), salt, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(bound(pairId, publicKey));
  const data = Buffer.concat([cipher.update(d), cipher.final()]);
  return {
    kdf: "scrypt",
    ...SCRYPT,
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
}

/** A new key pair for a recovery key: the keys file (public key, private key locked). */
export async function makeKeyFile(recoveryKey: string, now = new Date()): Promise<KeyFile> {
  const problem = recoveryKeyProblem(recoveryKey);
  if (problem) throw new BackupKeyError(`${problem}.`);
  const pair = generateKeyPairSync("x25519");
  const publicRaw = rawKey(pair.publicKey);
  const publicKey = publicRaw.toString("base64url");
  const pairId = pairIdOf(publicRaw);
  const d = rawKey(pair.privateKey, "d");
  try {
    return {
      app: "Extas ERP",
      kind: "backup-keys",
      version: 1,
      pairId,
      publicKey,
      createdAt: now.toISOString(),
      lockedPrivateKey: await lockPrivate(d, recoveryKey, pairId, publicKey),
    };
  } finally {
    d.fill(0);
  }
}

/** Reads a keys file (as saved, or from a backup), checking its shape. */
export function parseKeyFile(text: string): KeyFile {
  let file: KeyFile;
  try {
    file = JSON.parse(text) as KeyFile;
  } catch {
    throw new BackupKeyError("The keys file is damaged.");
  }
  const locked = file?.lockedPrivateKey;
  if (
    file?.kind !== "backup-keys" ||
    file.version !== 1 ||
    typeof file.publicKey !== "string" ||
    typeof file.pairId !== "string" ||
    locked?.kdf !== "scrypt" ||
    pairIdOf(Buffer.from(file.publicKey, "base64url")) !== file.pairId
  ) {
    throw new BackupKeyError("The keys file is damaged.");
  }
  return file;
}

/** The public key in a keys file. */
export function publicKeyOf(file: KeyFile): PublicKey {
  return { pairId: file.pairId, key: Buffer.from(file.publicKey, "base64url") };
}

/**
 * The private key, opened with the recovery key; a wrong key is refused. The
 * caller uses it at once and keeps it nowhere.
 */
export async function openKeyFile(file: KeyFile, recoveryKey: string): Promise<KeyObject> {
  const locked = file.lockedPrivateKey;
  if (locked.N > 1 << 20 || locked.r > 16 || locked.p > 4) {
    throw new BackupKeyError("The keys file asks for more work than the ERP allows.");
  }
  const key = await scrypt(
    normalizeRecoveryKey(recoveryKey),
    Buffer.from(locked.salt, "base64url"),
    {
      N: locked.N,
      r: locked.r,
      p: locked.p,
    },
  );
  let d: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(locked.iv, "base64url"));
    decipher.setAAD(bound(file.pairId, file.publicKey));
    decipher.setAuthTag(Buffer.from(locked.tag, "base64url"));
    d = Buffer.concat([decipher.update(Buffer.from(locked.data, "base64url")), decipher.final()]);
  } catch {
    throw new BackupKeyError("This recovery key is not the one these backups were locked with.");
  }
  try {
    const privateKey = privateKeyObject(d, Buffer.from(file.publicKey, "base64url"));
    // The private key must belong to this public key.
    if (!rawKey(privateKey).equals(Buffer.from(file.publicKey, "base64url"))) {
      throw new BackupKeyError("The keys file is damaged.");
    }
    return privateKey;
  } finally {
    d.fill(0);
  }
}

/** The same key pair, its private key locked with a new recovery key (the old one must open it). */
export async function relockKeyFile(
  file: KeyFile,
  oldKey: string,
  newKey: string,
): Promise<KeyFile> {
  const problem = recoveryKeyProblem(newKey);
  if (problem) throw new BackupKeyError(`${problem}.`);
  const privateKey = await openKeyFile(file, oldKey);
  const d = rawKey(privateKey, "d");
  try {
    return {
      ...file,
      lockedPrivateKey: await lockPrivate(d, newKey, file.pairId, file.publicKey),
    };
  } finally {
    d.fill(0);
  }
}
