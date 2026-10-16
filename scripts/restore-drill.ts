/**
 * The old server's half of the restore drill (.github/workflows/restore-drill.yml).
 * On a database loaded with the demo data it does what the owner does on the
 * Backups screen: makes the recovery key, connects Google Drive with the code on
 * the phone, and backs up, until the backup is locked, in Drive and checked. A
 * stand-in for Google (scripts/fake-google.ts) plays Google's part. Then
 * deploy/bootstrap.sh builds a new server from that backup.
 *   DATABASE_URL, BACKUP_DIR, ENCRYPTION_KEY, PG_DUMP_PATH   the old server
 *   GOOGLE_DRIVE_CLIENT_ID / _SECRET, GOOGLE_OAUTH_BASE, GOOGLE_DRIVE_BASE
 *   SEED_ADMIN_EMAIL   the owner
 *   RECOVERY_KEY_OUT   where the recovery key goes (for the new server)
 *   FACTS_OUT          the old server's row counts, to compare after the restore
 * Only for the drill: it refuses any database but "extras_demo".
 */
import { writeFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import {
  checkGoogleSignIn,
  confirmRecoveryKey,
  getBackupRun,
  makeRecoveryKey,
  runBackup,
  startGoogleSignIn,
} from "@/modules/backups/backup.service";

const say = (text: string) => console.log(`==> ${text}`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The tables bootstrap.sh's restore is compared on. */
export const DRILL_TABLES = [
  "Company",
  "User",
  "Party",
  "Booking",
  "ProductionProject",
  "JournalEntry",
];

async function main() {
  const [row] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const db = row?.db;
  if (db !== "extras_demo")
    throw new Error(`refused: the drill runs only on extras_demo, not ${db}`);
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("SEED_ADMIN_EMAIL is not set");
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { memberships: { take: 1 } },
  });
  const actor = { userId: owner.id };
  const ctx = {
    user: owner,
    companyId: owner.memberships[0]!.companyId,
  } as unknown as CompanyContext;

  const made = await makeRecoveryKey(ctx, {});
  await confirmRecoveryKey(actor, { lastGroup: made.recoveryKey.split("-").at(-1) });
  say(`Recovery key ${made.keyId} made and confirmed`);

  const code = await startGoogleSignIn(actor);
  say(`Google sign-in code ${code.userCode} at ${code.verificationUrl}`);
  for (let i = 0; ; i++) {
    const poll = await checkGoogleSignIn(actor);
    if (poll.status === "connected") break;
    if (poll.status !== "waiting" || i > 60)
      throw new Error(`Google sign-in ended: ${poll.status}`);
    await wait(code.interval * 1000);
  }
  say("Google Drive connected");

  const started = await runBackup({ trigger: "MANUAL", actor });
  let run = started;
  for (
    let i = 0;
    run.status === "RUNNING" || (run.status === "SUCCEEDED" && !run.checkedAt && !run.driveError);
    i++
  ) {
    if (i > 600) throw new Error("the backup did not finish in 10 minutes");
    await wait(1000);
    run = await getBackupRun(started.id);
  }
  if (run.status !== "SUCCEEDED" || !run.checkedAt) {
    throw new Error(`the backup did not reach Drive: ${run.error ?? run.driveError ?? run.status}`);
  }
  say(`Backup ${run.name ?? run.id} locked with ${run.keyId}, in Google Drive and checked`);

  const counts: Record<string, number> = {};
  for (const table of DRILL_TABLES) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "${table}"`,
    );
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  say(
    `Old server: ${Object.entries(counts)
      .map(([t, n]) => `${n} ${t}`)
      .join(", ")}`,
  );
  await writeFile(process.env.RECOVERY_KEY_OUT ?? "recovery-key", `${made.recoveryKey}\n`, {
    mode: 0o600,
  });
  await writeFile(
    process.env.FACTS_OUT ?? "old-server.json",
    JSON.stringify({ backup: run.name, counts }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
