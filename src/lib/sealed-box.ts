import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  timingSafeEqual,
} from "node:crypto";

/*
 * libsodium's sealed box (crypto_box_seal): how GitHub wants a repository
 * secret sent (PUT /repos/{repo}/actions/secrets/{name}), locked to the
 * repository's public key so only GitHub Actions can open it. X25519 comes
 * from Node; XSalsa20-Poly1305 and BLAKE2b, which Node does not have, are
 * written out here from their specifications, and the tests check them
 * against libsodium's own output (tests/unit/sealed-box.test.ts).
 *   sealed = ephemeral public key (32) || box(message), with
 *   nonce  = BLAKE2b-192(ephemeral public key || recipient public key)
 */

const MASK32 = 0xffffffff;
const rotl = (v: number, n: number) => ((v << n) | (v >>> (32 - n))) >>> 0;
const word = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]; // "expand 32-byte k"

/** The 20 Salsa20 rounds over a 16-word state, in place. */
function salsaRounds(x: number[]) {
  const qr = (a: number, b: number, c: number, d: number) => {
    x[b] = (x[b]! ^ rotl((x[a]! + x[d]!) & MASK32, 7)) >>> 0;
    x[c] = (x[c]! ^ rotl((x[b]! + x[a]!) & MASK32, 9)) >>> 0;
    x[d] = (x[d]! ^ rotl((x[c]! + x[b]!) & MASK32, 13)) >>> 0;
    x[a] = (x[a]! ^ rotl((x[d]! + x[c]!) & MASK32, 18)) >>> 0;
  };
  for (let i = 0; i < 10; i += 1) {
    qr(0, 4, 8, 12);
    qr(5, 9, 13, 1);
    qr(10, 14, 2, 6);
    qr(15, 3, 7, 11);
    qr(0, 1, 2, 3);
    qr(5, 6, 7, 4);
    qr(10, 11, 8, 9);
    qr(15, 12, 13, 14);
  }
}

/** The state for a 32-byte key and 16 bytes of nonce (and counter). */
function salsaState(key: Uint8Array, input: Uint8Array) {
  return [
    SIGMA[0]!,
    word(key, 0),
    word(key, 4),
    word(key, 8),
    word(key, 12),
    SIGMA[1]!,
    word(input, 0),
    word(input, 4),
    word(input, 8),
    word(input, 12),
    SIGMA[2]!,
    word(key, 16),
    word(key, 20),
    word(key, 24),
    word(key, 28),
    SIGMA[3]!,
  ];
}

function bytesOf(words: number[]): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  words.forEach((w, i) => {
    out[i * 4] = w & 0xff;
    out[i * 4 + 1] = (w >>> 8) & 0xff;
    out[i * 4 + 2] = (w >>> 16) & 0xff;
    out[i * 4 + 3] = (w >>> 24) & 0xff;
  });
  return out;
}

/** HSalsa20: a 32-byte key from a key and 16 bytes of nonce. */
export function hsalsa20(key: Uint8Array, nonce16: Uint8Array): Uint8Array {
  const x = salsaState(key, nonce16);
  salsaRounds(x);
  return bytesOf([x[0]!, x[5]!, x[10]!, x[15]!, x[6]!, x[7]!, x[8]!, x[9]!]);
}

/** `length` bytes of the XSalsa20 stream for a 32-byte key and 24-byte nonce. */
function xsalsa20Stream(key: Uint8Array, nonce: Uint8Array, length: number): Uint8Array {
  const subkey = hsalsa20(key, nonce.subarray(0, 16));
  const out = new Uint8Array(length);
  const input = new Uint8Array(16);
  input.set(nonce.subarray(16, 24), 0);
  for (let block = 0; block * 64 < length; block += 1) {
    // The 64-bit block counter, little-endian, after the nonce.
    let n = block;
    for (let i = 8; i < 16; i += 1) {
      input[i] = n & 0xff;
      n = Math.floor(n / 256);
    }
    const start = salsaState(subkey, input);
    const x = [...start];
    salsaRounds(x);
    const bytes = bytesOf(x.map((v, i) => (v + start[i]!) >>> 0));
    out.set(bytes.subarray(0, Math.min(64, length - block * 64)), block * 64);
  }
  return out;
}

const leBig = (b: Uint8Array) => {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i -= 1) n = (n << 8n) | BigInt(b[i]!);
  return n;
};

/** Poly1305: the 16-byte tag of a message under a one-time 32-byte key. */
export function poly1305(key: Uint8Array, message: Uint8Array): Uint8Array {
  const p = (1n << 130n) - 5n;
  const r = leBig(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = leBig(key.subarray(16, 32));
  let acc = 0n;
  for (let i = 0; i < message.length; i += 16) {
    const block = message.subarray(i, i + 16);
    const n = leBig(block) | (1n << BigInt(8 * block.length));
    acc = ((acc + n) * r) % p;
  }
  acc = (acc + s) & ((1n << 128n) - 1n);
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    tag[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return tag;
}

const MASK64 = (1n << 64n) - 1n;
const B2B_IV = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];
const B2B_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];
const rotr64 = (v: bigint, n: bigint) => ((v >> n) | (v << (64n - n))) & MASK64;

/** BLAKE2b with no key and an output of `outlen` bytes (1 to 64). */
export function blake2b(data: Uint8Array, outlen: number): Uint8Array {
  const h = [...B2B_IV];
  h[0] = h[0]! ^ 0x01010000n ^ BigInt(outlen);
  const blocks = Math.max(1, Math.ceil(data.length / 128));
  for (let b = 0; b < blocks; b += 1) {
    const chunk = new Uint8Array(128);
    chunk.set(data.subarray(b * 128, b * 128 + 128));
    const m = Array.from({ length: 16 }, (_, i) => leBig(chunk.subarray(i * 8, i * 8 + 8)));
    const last = b === blocks - 1;
    const t = BigInt(last ? data.length : (b + 1) * 128);
    const v = [...h, ...B2B_IV];
    v[12] = v[12]! ^ (t & MASK64);
    v[13] = v[13]! ^ (t >> 64n);
    if (last) v[14] = v[14]! ^ MASK64;
    const g = (a: number, b2: number, c: number, d: number, x: bigint, y: bigint) => {
      v[a] = (v[a]! + v[b2]! + x) & MASK64;
      v[d] = rotr64(v[d]! ^ v[a]!, 32n);
      v[c] = (v[c]! + v[d]!) & MASK64;
      v[b2] = rotr64(v[b2]! ^ v[c]!, 24n);
      v[a] = (v[a]! + v[b2]! + y) & MASK64;
      v[d] = rotr64(v[d]! ^ v[a]!, 16n);
      v[c] = (v[c]! + v[d]!) & MASK64;
      v[b2] = rotr64(v[b2]! ^ v[c]!, 63n);
    };
    for (let round = 0; round < 12; round += 1) {
      const s = B2B_SIGMA[round % 10]!;
      g(0, 4, 8, 12, m[s[0]!]!, m[s[1]!]!);
      g(1, 5, 9, 13, m[s[2]!]!, m[s[3]!]!);
      g(2, 6, 10, 14, m[s[4]!]!, m[s[5]!]!);
      g(3, 7, 11, 15, m[s[6]!]!, m[s[7]!]!);
      g(0, 5, 10, 15, m[s[8]!]!, m[s[9]!]!);
      g(1, 6, 11, 12, m[s[10]!]!, m[s[11]!]!);
      g(2, 7, 8, 13, m[s[12]!]!, m[s[13]!]!);
      g(3, 4, 9, 14, m[s[14]!]!, m[s[15]!]!);
    }
    for (let i = 0; i < 8; i += 1) h[i] = h[i]! ^ v[i]! ^ v[i + 8]!;
  }
  const out = new Uint8Array(64);
  h.forEach((w, i) => {
    for (let j = 0; j < 8; j += 1) out[i * 8 + j] = Number((w >> BigInt(8 * j)) & 0xffn);
  });
  return out.slice(0, outlen);
}

/** XSalsa20-Poly1305 (crypto_secretbox): tag (16) || ciphertext. */
function secretbox(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  const stream = xsalsa20Stream(key, nonce, 32 + message.length);
  const cipher = message.map((byte, i) => byte ^ stream[32 + i]!);
  const out = new Uint8Array(16 + cipher.length);
  out.set(poly1305(stream.subarray(0, 32), cipher), 0);
  out.set(cipher, 16);
  return out;
}

// X25519 keys from raw bytes, through the DER forms Node reads.
const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
const privateKeyOf = (raw: Uint8Array) =>
  createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: "der", type: "pkcs8" });
const publicKeyOf = (raw: Uint8Array) =>
  createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: "der", type: "spki" });
const rawPublic = (key: ReturnType<typeof createPublicKey>) =>
  new Uint8Array(key.export({ format: "der", type: "spki" }).subarray(SPKI_X25519.length));

/**
 * Seals a message to a 32-byte X25519 public key (crypto_box_seal). A new
 * ephemeral key each time; `ephemeralSecret` only for the tests' fixed vectors.
 */
export function sealedBox(
  message: Uint8Array,
  recipientPublicKey: Uint8Array,
  ephemeralSecret?: Uint8Array,
): Uint8Array {
  if (recipientPublicKey.length !== 32) throw new Error("The public key must be 32 bytes.");
  const esk = ephemeralSecret
    ? privateKeyOf(ephemeralSecret)
    : generateKeyPairSync("x25519").privateKey;
  const epk = rawPublic(createPublicKey(esk));
  const shared = diffieHellman({ privateKey: esk, publicKey: publicKeyOf(recipientPublicKey) });
  const key = hsalsa20(new Uint8Array(shared), new Uint8Array(16));
  const nonce = blake2b(new Uint8Array([...epk, ...recipientPublicKey]), 24);
  const box = secretbox(message, nonce, key);
  const out = new Uint8Array(32 + box.length);
  out.set(epk, 0);
  out.set(box, 32);
  return out;
}

/**
 * Opens a sealed box with the recipient's key pair (crypto_box_seal_open); null
 * when it was not sealed to this key or was changed. Used by the tests.
 */
export function sealedBoxOpen(
  sealed: Uint8Array,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array | null {
  if (sealed.length < 48) return null;
  const epk = sealed.subarray(0, 32);
  const shared = diffieHellman({
    privateKey: privateKeyOf(secretKey),
    publicKey: publicKeyOf(epk),
  });
  const key = hsalsa20(new Uint8Array(shared), new Uint8Array(16));
  const nonce = blake2b(new Uint8Array([...epk, ...publicKey]), 24);
  const tag = sealed.subarray(32, 48);
  const cipher = sealed.subarray(48);
  const stream = xsalsa20Stream(key, nonce, 32 + cipher.length);
  const expected = poly1305(stream.subarray(0, 32), cipher);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(tag))) return null;
  return cipher.map((byte, i) => byte ^ stream[32 + i]!);
}
