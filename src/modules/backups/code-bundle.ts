import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

/*
 * The code inside a backup (G15): a git bundle the server makes at each update
 * (deploy/lib.sh record_host_files, where git itself checks it). The drill runs
 * in the app, which has no git, so it reads the bundle here: its header must
 * list the backup's commit and need no history from elsewhere, and its pack's
 * own checksum (the last bytes, over everything before them) must match.
 */

const DAMAGED = "the code in the backup is damaged";
const HEADER_LIMIT = 1024 * 1024;

/** Why the code bundle at `file` is not right for `commit`, or null when it is. */
export async function checkCodeBundle(file: string, commit: string | null): Promise<string | null> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(size, HEADER_LIMIT));
    await handle.read(head, 0, head.length, 0);
    const end = head.indexOf("\n\n");
    if (end < 0) return DAMAGED;
    const lines = head.subarray(0, end).toString("utf8").split("\n");
    const signature = lines.shift();
    if (signature !== "# v2 git bundle" && signature !== "# v3 git bundle") return DAMAGED;
    let algorithm = "sha1";
    const refs: string[] = [];
    let prerequisites = 0;
    for (const line of lines) {
      if (line.startsWith("@")) {
        if (line === "@object-format=sha256") algorithm = "sha256";
      } else if (line.startsWith("-")) {
        prerequisites += 1;
      } else {
        const [oid] = line.split(" ");
        if (!oid || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(oid)) return DAMAGED;
        refs.push(oid);
      }
    }
    const trailer = algorithm === "sha256" ? 32 : 20;
    const packStart = end + 2;
    if (size - packStart < 12 + trailer) return DAMAGED;
    const pack = Buffer.alloc(12);
    await handle.read(pack, 0, 12, packStart);
    const version = pack.readUInt32BE(4);
    if (pack.subarray(0, 4).toString("latin1") !== "PACK" || (version !== 2 && version !== 3)) {
      return DAMAGED;
    }
    if (pack.readUInt32BE(8) === 0) return DAMAGED;
    // The pack's checksum over all of it but the checksum itself.
    const hash = createHash(algorithm);
    const chunk = Buffer.alloc(1024 * 1024);
    for (let at = packStart; at < size - trailer;) {
      const want = Math.min(chunk.length, size - trailer - at);
      const { bytesRead } = await handle.read(chunk, 0, want, at);
      if (bytesRead <= 0) return DAMAGED;
      hash.update(chunk.subarray(0, bytesRead));
      at += bytesRead;
    }
    const stored = Buffer.alloc(trailer);
    await handle.read(stored, 0, trailer, size - trailer);
    if (!hash.digest().equals(stored)) return DAMAGED;
    if (prerequisites > 0) {
      return "the code in the backup is not complete (it needs history from elsewhere)";
    }
    if (commit && !refs.includes(commit)) {
      return "the code in the backup is not the backup's version";
    }
    return null;
  } finally {
    await handle.close();
  }
}
