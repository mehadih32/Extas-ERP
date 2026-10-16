import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { BackupTrigger, Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import {
  type Actor,
  alertOwner,
  audit,
  backupRoot,
  currentKey,
  driveToken,
  getBackupConfig,
  pgEnvironment,
  pgTool,
  reasonFor,
} from "@/modules/backups/backup-core";
import { claimRun, getBackupRun } from "@/modules/backups/backup.service";
import { fetchBackup, listDriveBackups } from "@/modules/backups/drive-copies";

/*
 * The weekly proof that the backups work: the newest checked backup is
 * downloaded from Google Drive, opened with the recovery key, and restored into
 * a temporary database of its own on the same database server (never the live
 * or the demo site's database), which is checked and then dropped. The result
 * goes to the owner's inbox (and the bot when it fails).
 */

const exec = promisify(execFile);
const LONG_JOB = { timeout: 2 * 60 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 };
/** Temporary databases are named so; nothing else is ever dropped. */
export const TEST_DB_PREFIX = "extas_restore_test_";

/** Tables counted in the backup and today, to show the backup holds the business. */
const COUNTED = [
  "Company",
  "User",
  "Party",
  "SalesOrder",
  "Invoice",
  "Payment",
  "JournalEntry",
  "Employee",
  "ProductionProject",
  "Booking",
] as const;

export type TestRestoreReport = {
  backup: string;
  backupAt: string;
  downloadedBytes: number;
  tables: number;
  migrations: number;
  newestMigration: string | null;
  counts: Record<string, { backup: number; now: number }>;
  /** Every journal entry's debits equal its credits in the restored copy. */
  ledgerBalanced: boolean;
  mediaFiles: number | null;
  seconds: number;
};

function quoteIdent(name: string) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe database name ${name}`);
  return `"${name}"`;
}

/** Drops temporary databases a stopped test left behind. */
async function dropLeftovers() {
  const rows = await prisma.$queryRaw<Array<{ datname: string }>>`
    SELECT datname FROM pg_database WHERE datname LIKE ${`${TEST_DB_PREFIX}%`}`;
  for (const { datname } of rows) {
    if (!datname.startsWith(TEST_DB_PREFIX)) continue;
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(datname)} WITH (FORCE)`);
  }
}

async function psql(env: NodeJS.ProcessEnv, sql: string): Promise<string> {
  const { stdout } = await exec(pgTool("psql"), ["-X", "-tAc", sql], { env, ...LONG_JOB });
  return stdout.trim();
}

async function liveCount(table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM "${table}"`,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Runs the test restore now. The scheduler runs it weekly (no actor); "Test a
 * restore now" on the Backups screen waits for nothing and returns the run.
 */
export async function runTestRestore(
  options: { trigger: BackupTrigger; actor?: Actor | null; wait?: boolean },
  meta?: RequestMeta,
) {
  const config = await getBackupConfig();
  const key = currentKey(config);
  if (!key)
    throw new AppError("CONFLICT", "Make the recovery key first: backups are locked with it.");
  if (!config.credentialsRef) throw new AppError("CONFLICT", "Connect Google Drive first.");
  const actor = options.actor ?? null;
  const run = await claimRun(options.trigger, actor, "TEST_RESTORE");
  await audit(actor, meta, {
    action: "CREATE",
    entityType: "BackupRun",
    entityId: run.id,
    summary: `${options.trigger === "MANUAL" ? "Started" : "Scheduled"} a test restore into a temporary database`,
  });
  const job = testRestore(run.id, key).catch((error: unknown) =>
    console.error("[backups] test restore failed", error),
  );
  if (options.wait ?? options.trigger === "SCHEDULED") await job;
  return getBackupRun(run.id);
}

async function testRestore(runId: string, key: { key: Buffer; id: string }) {
  const started = Date.now();
  const work = path.join(backupRoot(), ".test-restore");
  const database = `${TEST_DB_PREFIX}${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const liveUrl = process.env.DATABASE_URL ?? "";
  let backupName: string | null = null;
  let created = false;
  try {
    const live = pgEnvironment(liveUrl).PGDATABASE;
    if (database === live || !database.startsWith(TEST_DB_PREFIX)) {
      throw new Error("refused: the temporary database must not be the live one");
    }
    await dropLeftovers();
    const config = await getBackupConfig();
    const token = await driveToken(config);
    if (!token) throw new Error("Google Drive is not connected");
    const newest = (await listDriveBackups()).items.find((b) => b.kind === "BACKUP" && b.checked);
    if (!newest) throw new Error("there is no checked backup in Google Drive yet");
    backupName = newest.name;
    await prisma.backupRun.update({ where: { id: runId }, data: { sourceName: newest.name } });
    const fetched = await fetchBackup(token, { id: newest.folderId, name: newest.name }, work, key);

    try {
      await prisma.$executeRawUnsafe(`CREATE DATABASE ${quoteIdent(database)}`);
    } catch (error) {
      throw new Error(
        `the database user may not make a temporary database (${reasonFor(error)}); run sudo ./deploy/deploy.sh once, which allows it`,
      );
    }
    created = true;
    const env = { ...process.env, ...pgEnvironment(liveUrl), PGDATABASE: database };
    await exec(
      pgTool("pg_restore"),
      ["--no-owner", "--no-privileges", "--exit-on-error", "-d", database, fetched.database],
      { env, ...LONG_JOB },
    );
    const tables = Number(
      await psql(
        env,
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
      ),
    );
    const migrations = Number(await psql(env, 'SELECT count(*) FROM "_prisma_migrations"'));
    const newestMigration =
      (await psql(
        env,
        'SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name DESC LIMIT 1',
      )) || null;
    const counts: TestRestoreReport["counts"] = {};
    for (const table of COUNTED) {
      const inBackup = Number(await psql(env, `SELECT count(*) FROM "${table}"`).catch(() => "0"));
      counts[table] = { backup: inBackup, now: await liveCount(table).catch(() => 0) };
    }
    const unbalanced = Number(
      await psql(
        env,
        'SELECT count(*) FROM (SELECT "entryId" FROM "JournalLine" GROUP BY "entryId" HAVING sum(debit) <> sum(credit)) x',
      ),
    );
    let mediaFiles: number | null = null;
    if (fetched.media) {
      const { stdout } = await exec("tar", ["-tzf", fetched.media], LONG_JOB);
      mediaFiles = stdout.split("\n").filter((l) => l && !l.endsWith("/")).length;
    }
    const report: TestRestoreReport = {
      backup: newest.name,
      backupAt: fetched.manifest.createdAt,
      downloadedBytes: newest.bytes ?? 0,
      tables,
      migrations,
      newestMigration,
      counts,
      ledgerBalanced: unbalanced === 0,
      mediaFiles,
      seconds: Math.round((Date.now() - started) / 1000),
    };
    const problems = [
      ...(tables < 10 ? [`only ${tables} tables came back`] : []),
      ...(counts.Company!.backup === 0 ? ["no company came back"] : []),
      ...(unbalanced > 0 ? [`${unbalanced} journal entries do not balance`] : []),
    ];
    await prisma.backupRun.update({
      where: { id: runId },
      data: {
        status: problems.length ? "FAILED" : "SUCCEEDED",
        finishedAt: new Date(),
        report: report as unknown as Prisma.InputJsonObject,
        error: problems.length ? `The restored copy is not right: ${problems.join("; ")}.` : null,
      },
    });
    const summary = `${newest.name}: ${tables} tables, ${counts.Company!.backup} companies, ${counts.SalesOrder!.backup} sales orders, ${counts.Invoice!.backup} invoices${mediaFiles !== null ? `, ${mediaFiles} files` : ""}, in ${report.seconds} seconds.`;
    if (problems.length) {
      await alertOwner("Test restore failed", `${problems.join("; ")} (${summary})`, runId);
    } else {
      await alertOwner(
        "Test restore worked",
        `The newest backup restored into a temporary database: ${summary}`,
        runId,
      );
    }
  } catch (error) {
    await prisma.backupRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: reasonFor(error),
        sourceName: backupName,
      },
    });
    await alertOwner(
      "Test restore failed",
      `${backupName ? `The ${backupName} backup` : "The newest backup"} could not be restored into a temporary database: ${reasonFor(error)}`,
      runId,
    );
  } finally {
    if (created) {
      await prisma
        .$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`)
        .catch((error: unknown) =>
          console.error("[backups] could not drop the test database", error),
        );
    }
    await rm(work, { recursive: true, force: true });
  }
}
