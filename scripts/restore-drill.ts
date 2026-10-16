/**
 * The old server's half of the restore drill (.github/workflows/restore-drill.yml).
 * On a database loaded with the demo data it does what the owner does on the
 * Backups screen: connects Google Drive with the code on the phone, sets the
 * recovery key (kept in Drive), and backs up, until the backup is locked, in
 * Drive and checked. A
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
import { tenantDb } from "@/lib/tenant-db";
import type { CompanyContext } from "@/modules/auth/context";
import type { PermissionKey } from "@/modules/rbac/permissions";
import { setPin } from "@/modules/ai/settings.service";
import {
  checkGoogleSignIn,
  getBackupRun,
  runBackup,
  startGoogleSignIn,
} from "@/modules/backups/backup.service";
import { setRecoveryKey } from "@/modules/backups/recovery-key.service";
import { resolveCompanyAccess } from "@/modules/companies/access";

/** The drill's own recovery key and PIN (a practice database only). */
const DRILL_KEY = "restore drill practice key 2026";
const DRILL_PIN = "2468";

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
  const companyId = owner.memberships[0]!.companyId;
  const access = (await resolveCompanyAccess(owner, companyId))!;
  // The owner in their company, as on the Backups screen (for the PIN).
  const ctx = {
    user: owner,
    ...access,
    db: tenantDb(companyId),
    can: (p: PermissionKey) => access.permissions.has(p),
  } as unknown as CompanyContext;

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

  await setPin(ctx, { pin: DRILL_PIN });
  const set = await setRecoveryKey(ctx, {
    pin: DRILL_PIN,
    key: DRILL_KEY,
    confirm: DRILL_KEY,
    keepInDrive: true,
  });
  say(`Recovery key set (key ${set.config.recoveryKey.pairId}), kept in Google Drive`);

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
  await writeFile(process.env.RECOVERY_KEY_OUT ?? "recovery-key", `${DRILL_KEY}\n`, {
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
