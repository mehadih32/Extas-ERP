/**
 * Locks the server's settings (deploy/.env) for the owner's backup public key, so
 * every backup carries them and only the owner's recovery key opens them (G3, A9).
 * deploy/lib.sh (lock_settings) runs it on the server at each update and when the
 * owner sets the recovery key, in the tools image with no network:
 *   docker run --rm -i --network none -v <key>:/in/key.json:ro -v <.host>:/out \
 *     extras-erp-tools:latest npx tsx scripts/lock-settings.ts < deploy/.env
 * The settings come in on stdin and leave only locked: settings.env.locked.new and
 * settings.env.json.new (the key pair and both files' size and SHA-256), which
 * lock_settings moves into place. Nothing of the settings is printed.
 *   KEY_FILE (/in/key.json), OUT_DIR (/out)   other places, for the tests
 */
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { lockStreamFor, measure } from "@/modules/backups/crypt";

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function main() {
  const keyFile = process.env.KEY_FILE || "/in/key.json";
  const out = process.env.OUT_DIR || "/out";
  const key = JSON.parse(await readFile(keyFile, "utf8")) as {
    kind?: string;
    pairId?: string;
    publicKey?: string;
  };
  if (
    key.kind !== "backup-public-key" ||
    !/^[0-9A-F]{8}$/.test(key.pairId ?? "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.publicKey ?? "")
  ) {
    throw new Error("the backup public key file is not right");
  }
  const settings = await readStdin();
  if (settings.length === 0) throw new Error("no settings came in");
  const plain = measure();
  const locked = measure();
  await pipeline(
    Readable.from([settings]),
    plain,
    lockStreamFor({ pairId: key.pairId!, key: Buffer.from(key.publicKey!, "base64url") }),
    locked,
    createWriteStream(path.join(out, "settings.env.locked.new"), { mode: 0o640 }),
  );
  settings.fill(0);
  await writeFile(
    path.join(out, "settings.env.json.new"),
    JSON.stringify({
      pairId: key.pairId,
      plain: { bytes: plain.result().bytes, sha256: plain.result().sha256 },
      locked: { bytes: locked.result().bytes, sha256: locked.result().sha256 },
      lockedAt: new Date().toISOString(),
    }),
    { mode: 0o640 },
  );
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
