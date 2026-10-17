import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";

/*
 * Every backup is locked before it leaves the server, with a key made from the
 * owner's recovery key: without the recovery key nobody (Google included) can
 * open a backup in Drive. The recovery key is shown to the owner once, to write
 * down; the server keeps its own sealed copy (ENCRYPTION_KEY) to lock the daily
 * backups and to restore from the Backups screen. A new server restores with
 * the written-down key (deploy/bootstrap.sh).
 *
 * The recovery key: 32 random bytes and a 20-bit check, written as 14 groups of
 * 4 letters and digits (Crockford base32: no I, L, O or U, so a hand-written key
 * reads back the same). A key with a typo is refused before any backup is tried.
 *
 * A locked file: "EXTASBK1", a 16-byte salt, then the file in pieces of 1 MiB,
 * each locked with AES-256-GCM under a key for this file alone (HKDF of the
 * backup key and the salt) and a nonce counting the pieces. The last piece is
 * marked as last, so a file cut short or with pieces swapped never opens.
 *
 * v6.4 (A9) locks with a public key instead: the server keeps only the public
 * key of the owner's key pair (keys.ts); the private key that opens the files
 * is itself locked with the owner's own recovery key. Such a file starts with
 * "EXTASPK1", the key pair's id (8 letters), and a fresh X25519 public key made
 * for this file alone; the key for the rest (an ordinary "EXTASBK1" file as
 * above) is HKDF-SHA256 of the X25519 shared secret, salted with both public
 * keys. Only the private key works it out again. deploy/restore-tool.py reads
 * every format the same way, without the ERP.
 */

const MAGIC = Buffer.from("EXTASBK1", "ascii");
const PK_MAGIC = Buffer.from("EXTASPK1", "ascii");
const PAIR_ID_BYTES = 8;
const X25519_BYTES = 32;
/** "EXTASPK1", the key pair's id and the file's own public key. */
const PK_HEADER_BYTES = PK_MAGIC.length + PAIR_ID_BYTES + X25519_BYTES;
const SALT_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES;
const TAG_BYTES = 16;
/** Plain bytes per locked piece. */
export const PIECE_BYTES = 1 << 20;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_BYTES = 32;
const KEY_CHARS = 52; // 256 bits in base32 (4 bits to spare)
const CHECK_CHARS = 4; // 20 bits

export class BackupKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupKeyError";
  }
}

function toBase32(bytes: Buffer, chars: number): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.slice(0, chars);
}

function fromBase32(text: string, bytes: number): Buffer {
  const out = Buffer.alloc(bytes);
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of text) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8 && at < bytes) {
      out[at++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

function checkOf(key: Buffer): string {
  return toBase32(
    createHash("sha256").update("extas-erp recovery key").update(key).digest(),
    CHECK_CHARS,
  );
}

function grouped(text: string): string {
  return text.match(/.{1,4}/g)!.join("-");
}

/** A new recovery key, as the owner writes it down. */
export function newRecoveryKey(): string {
  const key = randomBytes(KEY_BYTES);
  return grouped(toBase32(key, KEY_CHARS) + checkOf(key));
}

/**
 * The recovery key's 32 bytes, from the key as typed: spaces, dashes and small
 * letters are fine, and O, I and L are read as 0, 1 and 1.
 */
export function parseRecoveryKey(typed: string): Buffer {
  const text = typed
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (text.length !== KEY_CHARS + CHECK_CHARS || [...text].some((c) => !ALPHABET.includes(c))) {
    throw new BackupKeyError(
      `A recovery key is ${KEY_CHARS + CHECK_CHARS} letters and digits in 14 groups of 4; this one is not.`,
    );
  }
  const key = fromBase32(text.slice(0, KEY_CHARS), KEY_BYTES);
  const check = text.slice(KEY_CHARS);
  if (
    toBase32(key, KEY_CHARS) !== text.slice(0, KEY_CHARS) ||
    !timingSafeEqual(Buffer.from(checkOf(key)), Buffer.from(check))
  ) {
    throw new BackupKeyError("This recovery key has a typo: check each group against your copy.");
  }
  return key;
}

/** The key that locks backups, from the recovery key's bytes. */
export function backupKey(recovery: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", recovery, "extas-erp backups", "backup key v1", 32));
}

/** A short name for a backup key, saved with each backup (it reveals nothing of the key). */
export function keyId(key: Buffer): string {
  return Buffer.from(hkdfSync("sha256", key, "extas-erp backups", "key id", 4))
    .toString("hex")
    .toUpperCase();
}

function fileKey(key: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", key, salt, "backup file v1", 32));
}

function nonce(index: number): Buffer {
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(BigInt(index), 4);
  return iv;
}

function lockPiece(key: Buffer, index: number, plain: Buffer, last: boolean): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, nonce(index));
  cipher.setAAD(Buffer.from([last ? 1 : 0]));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body, cipher.getAuthTag()]);
}

/** Locks a stream of backup bytes; `prefix` goes first (a public-key file's header). */
export function lockStream(key: Buffer, prefix: Buffer = Buffer.alloc(0)): Transform {
  const salt = randomBytes(SALT_BYTES);
  const pieceKey = fileKey(key, salt);
  let pending = Buffer.alloc(0);
  let index = 0;
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      if (!started) {
        this.push(Buffer.concat([prefix, MAGIC, salt]));
        started = true;
      }
      pending = Buffer.concat([pending, chunk]);
      // A piece is sent only when more bytes follow it, so the last one is known.
      while (pending.length > PIECE_BYTES) {
        this.push(lockPiece(pieceKey, index++, pending.subarray(0, PIECE_BYTES), false));
        pending = pending.subarray(PIECE_BYTES);
      }
      done();
    },
    flush(done: TransformCallback) {
      if (!started) this.push(Buffer.concat([prefix, MAGIC, salt]));
      this.push(lockPiece(pieceKey, index, pending, true));
      done();
    },
  });
}

// --- Public-key files (v6.4) -------------------------------------------------------

/** A key pair's public half: its id and the raw X25519 key. */
export type PublicKey = { pairId: string; key: Buffer };
/** The private keys that may open a file, by key pair id. */
export type PrivateKeys = Map<string, KeyObject>;
/** What opens a locked file: the v6.3 backup key, the owner's private keys, or both. */
export type Opener = Buffer | { legacy?: Buffer | null; privateKeys?: PrivateKeys };

const b64url = (bytes: Buffer) => bytes.toString("base64url");

export function publicKeyObject(raw: Buffer): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64url(raw) }, format: "jwk" });
}

/** The raw 32 bytes of an X25519 key (public, or the private half with `d`). */
export function rawKey(key: KeyObject, part: "x" | "d" = "x"): Buffer {
  const jwk = key.export({ format: "jwk" }) as { x?: string; d?: string };
  return Buffer.from(jwk[part]!, "base64url");
}

export function privateKeyObject(d: Buffer, x: Buffer): KeyObject {
  return createPrivateKey({
    key: { kty: "OKP", crv: "X25519", d: b64url(d), x: b64url(x) },
    format: "jwk",
  });
}

function publicFileKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      shared,
      Buffer.concat([ephemeral, recipient]),
      "extas-erp public-key file v1",
      32,
    ),
  );
}

/** A file's header and key, locked for the owner's public key. */
function sealFor(recipient: PublicKey): { header: Buffer; key: Buffer } {
  if (!/^[0-9A-F]{8}$/.test(recipient.pairId) || recipient.key.length !== X25519_BYTES) {
    throw new BackupKeyError("The backup public key is not right.");
  }
  const eph = generateKeyPairSync("x25519");
  const ephRaw = rawKey(eph.publicKey);
  const shared = diffieHellman({
    privateKey: eph.privateKey,
    publicKey: publicKeyObject(recipient.key),
  });
  return {
    header: Buffer.concat([PK_MAGIC, Buffer.from(recipient.pairId, "ascii"), ephRaw]),
    key: publicFileKey(shared, ephRaw, recipient.key),
  };
}

/** Locks a stream of bytes for the owner's public key: only their private key opens it. */
export function lockStreamFor(recipient: PublicKey): Transform {
  const { header, key } = sealFor(recipient);
  return lockStream(key, header);
}

/** The key pair a public-key file was locked for; null for any other file. */
export function lockedForPair(head: Buffer): string | null {
  if (head.length < PK_MAGIC.length + PAIR_ID_BYTES) return null;
  if (!head.subarray(0, PK_MAGIC.length).equals(PK_MAGIC)) return null;
  return head.subarray(PK_MAGIC.length, PK_MAGIC.length + PAIR_ID_BYTES).toString("ascii");
}

function openerKeys(opener: Opener) {
  return Buffer.isBuffer(opener)
    ? { legacy: opener, privateKeys: new Map() as PrivateKeys }
    : { legacy: opener.legacy ?? null, privateKeys: opener.privateKeys ?? new Map() };
}

/** Whether the bytes so far could be the start of a locked file. */
function startsLocked(bytes: Buffer): boolean {
  const n = Math.min(bytes.length, MAGIC.length);
  if (bytes.length === 0) return false;
  const head = bytes.subarray(0, n);
  return head.equals(MAGIC.subarray(0, n)) || head.equals(PK_MAGIC.subarray(0, n));
}

/**
 * Opens a locked stream (a v6.3 file with the backup key, or a v6.4 file with the
 * private key of its pair); it fails on a wrong key, a changed byte or a file cut short.
 */
export function unlockStream(opener: Opener): Transform {
  const keys = openerKeys(opener);
  let pending = Buffer.alloc(0);
  let key: Buffer | null = null;
  let pieceKey: Buffer | null = null;
  let index = 0;
  let finished = false;

  /** The key for the v1 part, once the start of the file says which one. */
  const resolveKey = (): boolean => {
    if (key) return true;
    if (pending.length < MAGIC.length) return false;
    if (pending.subarray(0, MAGIC.length).equals(MAGIC)) {
      if (!keys.legacy) {
        throw new BackupKeyError(
          "This backup was locked with the old (v6.3) recovery key: type the key from the old key card.",
        );
      }
      key = keys.legacy;
      return true;
    }
    if (pending.length < PK_HEADER_BYTES) return false;
    const pairId = lockedForPair(pending)!;
    const privateKey = keys.privateKeys.get(pairId);
    if (!privateKey) {
      throw new BackupKeyError(
        `This backup was locked with another recovery key (key ${pairId}); the key given does not open it.`,
      );
    }
    const ephRaw = pending.subarray(PK_MAGIC.length + PAIR_ID_BYTES, PK_HEADER_BYTES);
    const shared = diffieHellman({ privateKey, publicKey: publicKeyObject(ephRaw) });
    key = publicFileKey(shared, Buffer.from(ephRaw), rawKey(privateKey, "x"));
    pending = pending.subarray(PK_HEADER_BYTES);
    return true;
  };

  /** One piece, tried as a middle piece and then as the last one. */
  const open = (body: Buffer, tag: Buffer): Buffer => {
    for (const last of [false, true]) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", pieceKey!, nonce(index));
        decipher.setAAD(Buffer.from([last ? 1 : 0]));
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(body), decipher.final()]);
        index += 1;
        finished = last;
        return plain;
      } catch {
        // Try the other mark; a wrong key or a changed byte fails both.
      }
    }
    throw new BackupKeyError(
      index === 0
        ? "This recovery key does not open this backup (or the file is damaged)."
        : "The backup file is damaged.",
    );
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      pending = Buffer.concat([pending, chunk]);
      try {
        if (!pieceKey) {
          if (!startsLocked(pending)) {
            throw new BackupKeyError("This is not a locked Extas ERP backup file.");
          }
          if (!resolveKey()) return done();
          if (pending.length < HEADER_BYTES) return done();
          if (!pending.subarray(0, MAGIC.length).equals(MAGIC)) {
            throw new BackupKeyError("The backup file is damaged.");
          }
          pieceKey = fileKey(key!, pending.subarray(MAGIC.length, HEADER_BYTES));
          pending = pending.subarray(HEADER_BYTES);
        }
        while (pending.length >= 4) {
          if (finished) throw new BackupKeyError("The backup file has bytes after its end.");
          const length = pending.readUInt32BE(0);
          if (length > PIECE_BYTES) throw new BackupKeyError("The backup file is damaged.");
          if (pending.length < 4 + length + TAG_BYTES) break;
          const body = pending.subarray(4, 4 + length);
          const tag = pending.subarray(4 + length, 4 + length + TAG_BYTES);
          pending = pending.subarray(4 + length + TAG_BYTES);
          this.push(open(body, tag));
        }
        done();
      } catch (error) {
        done(error as Error);
      }
    },
    flush(done: TransformCallback) {
      if (!pieceKey && !startsLocked(pending)) {
        return done(new BackupKeyError("This is not a locked Extas ERP backup file."));
      }
      if (!finished || pending.length > 0) {
        return done(new BackupKeyError("The backup file is cut short: download it again."));
      }
      done();
    },
  });
}

/** What a file's bytes were, as they passed: their count, SHA-256 and MD5 (Google Drive's check). */
export function measure(): Transform & {
  result: () => { bytes: number; sha256: string; md5: string };
} {
  const sha = createHash("sha256");
  const md5 = createHash("md5");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      sha.update(chunk);
      md5.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  let result: { bytes: number; sha256: string; md5: string } | null = null;
  return Object.assign(stream, {
    result: () => (result ??= { bytes, sha256: sha.digest("hex"), md5: md5.digest("hex") }),
  });
}

export type FileFacts = { bytes: number; sha256: string; md5: string };

/**
 * Locks `from` into `to` with the v6.3 backup key, or for the owner's public key;
 * the facts of the plain file and of the locked one.
 */
export async function lockFile(key: Buffer | PublicKey, from: string, to: string) {
  const plain = measure();
  const locked = measure();
  const lock = Buffer.isBuffer(key) ? lockStream(key) : lockStreamFor(key);
  await pipeline(createReadStream(from), plain, lock, locked, createWriteStream(to));
  return { plain: plain.result(), locked: locked.result() };
}

/** Opens the locked `from` into `to`; the facts of the plain file. */
export async function unlockFile(opener: Opener, from: string, to: string): Promise<FileFacts> {
  const plain = measure();
  await pipeline(createReadStream(from), unlockStream(opener), plain, createWriteStream(to));
  return plain.result();
}
