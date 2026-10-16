/**
 * The old server's half of the restore drill (.github/workflows/restore-drill.yml).
 * On a database loaded with the demo data it does what the owner does on the
 * Backups screen, with a stand-in for Google (scripts/fake-google.ts):
 *   keys     connects Google Drive with the code on the phone and sets the
 *            recovery key, kept in Drive (the ERP then writes the public key
 *            that deploy.sh locks deploy/.env with);
 *   backup   backs up now, until the backup is locked, in Drive and checked,
 *            and writes the one restore command the guide prints for it.
 * Between the two, the workflow leaves in BACKUP_DIR/.host what deploy.sh
 * leaves there on a server: the code bundle, the version and the locked settings.
 *   DATABASE_URL, BACKUP_DIR, ENCRYPTION_KEY, PG_DUMP_PATH   the old server
 *   GOOGLE_DRIVE_CLIENT_ID / _SECRET, GOOGLE_OAUTH_BASE, GOOGLE_DRIVE_BASE
 *   SEED_ADMIN_EMAIL   the owner
 *   COMMAND_OUT        where the restore command goes (backup)
 * Only for the drill: it refuses any database but "extras_demo".
 */
import { writeFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import { hostVersion } from "@/modules/backups/backup-core";
import {
  checkGoogleSignIn,
  getBackupRun,
  restoreCommandLines,
  runBackup,
  startGoogleSignIn,
} from "@/modules/backups/backup.service";
import { setRecoveryKey } from "@/modules/backups/recovery-key.service";
import { resolveCompanyAccess } from "@/modules/companies/access";
import type { PermissionKey } from "@/modules/rbac/permissions";

/** The drill's own recovery key and PIN (a practice database only). */
const DRILL_KEY = "restore drill practice key 2026";
const DRILL_PIN = "2468";

const say = (text: string) => console.log(`==> ${text}`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function theOwner() {
  const [row] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  if (row?.db !== "extras_demo")
    throw new Error(`refused: the drill runs only on extras_demo, not ${row?.db}`);
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("SEED_ADMIN_EMAIL is not set");
  return prisma.user.findUniqueOrThrow({
    where: { email },
    include: { memberships: { take: 1 } },
  });
}

async function keys() {
  const owner = await theOwner();
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
  if (!set.config.recoveryKey.inDriveAt) throw new Error("the recovery key is not in Drive");
  say(`Recovery key set (key ${set.config.recoveryKey.pairId}), kept in Google Drive`);
}

async function backup() {
  const owner = await theOwner();
  const started = await runBackup({ trigger: "MANUAL", actor: { userId: owner.id } });
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
  const lines = restoreCommandLines(await hostVersion());
  if (!lines) throw new Error("the server's version is not recorded (BACKUP_DIR/.host)");
  await writeFile(process.env.COMMAND_OUT ?? "restore-command.txt", `${lines.join("\n")}\n`);
  say("The restore command, as the guide prints it:");
  for (const line of lines) console.log(`    ${line}`);
}

const phases: Record<string, () => Promise<void>> = { keys, backup };
const phase = phases[process.argv[2] ?? ""];
(phase ? phase() : Promise.reject(new Error("say which part: keys or backup")))
  .catch((error: unknown) => {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
