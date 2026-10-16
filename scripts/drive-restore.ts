/**
 * The Google Drive part of setting up a new server from a backup (deploy/bootstrap.sh
 * runs it in the tools image, before the ERP runs on the new server):
 *   1. shows a Google sign-in code to enter on the owner's phone;
 *   2. lists the backups in that Google account's "Extas ERP Backups" folder;
 *   3. takes the newest checked one (or the one the owner picks);
 *   4. downloads it, checks every file and opens it with the recovery key into
 *      OUT_DIR/<name>, ready for deploy/restore.sh;
 *   5. writes the old server's facts (its ENCRYPTION_KEY and the owner's email)
 *      to SERVER_FILE, for deploy/.env.
 * It never changes anything in Drive and needs no database.
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  the "TVs and Limited Input devices" client
 *   RECOVERY_KEY_FILE  a file holding the recovery key (deleted once read)
 *   OUT_DIR            where the opened backup goes (/data/backups/restores)
 *   SERVER_FILE        where the old server's facts go (JSON)
 *   PICK               "newest" (the default) or a backup's name; "ask" lists them and asks
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import {
  type DriveBackup,
  fetchBackup,
  findBackupRoots,
  listBackupFolders,
  readyForRestore,
} from "@/modules/backups/drive-fetch";
import * as drive from "@/modules/backups/google-drive";

const say = (text: string) => console.log(`==> ${text}`);
function stop(text: string): never {
  console.error(`\nError: ${text}`);
  process.exit(1);
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function size(bytes: number | null) {
  if (bytes === null) return "?";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) stop(`${name} is not set.`);
  return value;
}

async function signIn(client: drive.GoogleClient): Promise<string> {
  const start = await drive.startDeviceSignIn(client);
  console.log("");
  console.log("  Sign in to Google with the account the ERP's backups go to:");
  console.log(`    1. On your phone, open  ${start.verificationUrl}`);
  console.log(`    2. Enter this code:     ${start.userCode}`);
  console.log("    3. Allow Extas ERP to see the files it made in your Google Drive.");
  console.log("");
  say("Waiting for you to sign in on your phone");
  while (Date.now() < start.expiresAt.getTime()) {
    await wait(start.interval * 1000);
    const poll = await drive.pollDeviceSignIn(client, start.deviceCode).catch((error: unknown) => {
      // A dropped connection is asked again; anything else stops here.
      if (error instanceof drive.DriveError) throw error;
      return { status: "waiting" } as const;
    });
    if (poll.status === "connected") return poll.accessToken;
    if (poll.status === "denied")
      stop("the sign-in was refused on the phone. Run the command again.");
    if (poll.status === "expired") break;
  }
  stop("the sign-in code expired before it was used. Run the command again.");
}

async function choose(backups: DriveBackup[], pick: string): Promise<DriveBackup> {
  const usable = backups.filter((b) => b.checked);
  if (pick === "newest") {
    const newest = usable.find((b) => b.kind === "BACKUP") ?? usable[0];
    if (!newest) {
      stop(
        backups.length
          ? `none of the ${backups.length} backup(s) in Drive is checked.`
          : "there are no backups in the Extas ERP Backups folder yet.",
      );
    }
    return newest;
  }
  if (pick !== "ask") {
    const named = backups.find((b) => b.name === pick);
    if (!named) stop(`there is no backup called ${pick} in Drive.`);
    if (!named.checked) stop(`${pick} was never checked in Drive; pick a checked one.`);
    return named;
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (
        await readline.question("Press Enter for the newest, or type a number: ")
      ).trim();
      if (!answer) return choose(backups, "newest");
      const chosen = backups[Number(answer) - 1];
      if (!chosen || !/^\d+$/.test(answer)) {
        console.log(`  Type a number from 1 to ${backups.length}.`);
        continue;
      }
      if (!chosen.checked) {
        console.log("  That one was never checked in Drive; pick a checked one.");
        continue;
      }
      return chosen;
    }
  } finally {
    readline.close();
  }
}

async function main() {
  const client = { clientId: need("GOOGLE_CLIENT_ID"), clientSecret: need("GOOGLE_CLIENT_SECRET") };
  const keyFile = need("RECOVERY_KEY_FILE");
  const outDir = need("OUT_DIR");
  const serverFile = need("SERVER_FILE");
  const pick = process.env.PICK?.trim() || "newest";

  let recoveryKey: string;
  try {
    recoveryKey = (await readFile(keyFile, "utf8")).trim();
  } catch (error) {
    stop(error instanceof Error ? error.message : String(error));
  } finally {
    await rm(keyFile, { force: true });
  }

  const token = await signIn(client);
  const account = await drive.accountEmail(token).catch(() => null);
  say(`Signed in to Google${account ? ` as ${account}` : ""}`);

  const roots = await findBackupRoots(token);
  if (!roots.length) {
    stop(
      "this Google account's Drive has no Extas ERP Backups folder that this Google client made. Sign in with the account shown on the Backups screen, and use the command from that screen (it holds the same Google client).",
    );
  }
  const backups = (await Promise.all(roots.map((r) => listBackupFolders(token, r.id))))
    .flat()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  console.log("");
  console.log("  The backups in Google Drive (newest first):");
  backups.slice(0, 30).forEach((b, i) => {
    const when = b.createdAt ? b.createdAt.replace("T", " ").slice(0, 16) : "?";
    const kind = b.kind === "SAFETY_COPY" ? "safety copy" : "backup";
    const state = !b.checked ? "NOT checked" : `checked, key ${b.keyId ?? "none"}`;
    console.log(
      `  ${String(i + 1).padStart(3)}. ${when} UTC  ${size(b.bytes).padStart(9)}  ${kind.padEnd(11)} ${state}  ${b.name}`,
    );
  });
  console.log("");

  const chosen = await choose(backups, pick);
  say(`Downloading ${chosen.name} (${size(chosen.bytes)}) and opening it with the recovery key`);
  const started = Date.now();
  const fetched = await fetchBackup(token, { id: chosen.folderId, name: chosen.name }, outDir, {
    recoveryKey,
  });
  const server = await readyForRestore(fetched);
  say(
    `Downloaded, checked and opened in ${Math.round((Date.now() - started) / 1000)} seconds: ${fetched.dir}`,
  );
  if (!server?.encryptionKey) {
    say(
      "This backup has no server key (it was made before backups were locked): the settings sealed on the old server (Google, AI keys, bots) must be entered again after the restore",
    );
  }
  await writeFile(
    serverFile,
    JSON.stringify({
      name: chosen.name,
      folder: fetched.dir,
      createdAt: fetched.manifest.createdAt,
      encryptionKey: server?.encryptionKey ?? null,
      ownerEmail: server?.ownerEmail ?? null,
      appUrl: server?.appUrl ?? null,
    }),
    { mode: 0o600 },
  );
}

main().catch((error: unknown) => stop(error instanceof Error ? error.message : String(error)));
