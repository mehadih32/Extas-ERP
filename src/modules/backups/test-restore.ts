import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
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
import {
  compareContents,
  listFiles,
  totalRecords,
  type UploadFile,
} from "@/modules/backups/contents";
import { checkCodeBundle } from "@/modules/backups/code-bundle";
import { needRoom, NoRoomError } from "@/modules/backups/disk";
import { fetchBackup, listDriveBackups } from "@/modules/backups/drive-copies";
import { checkBackupFiles } from "@/modules/backups/drive-fetch";
import { parseKeyFile } from "@/modules/backups/keys";
import { recoveryKeyFromDrive } from "@/modules/backups/recovery-key.service";

/*
 * The monthly restore drill (G11): the newest checked backup is downloaded from
 * Google Drive, opened with the recovery key (kept in Drive, or typed for this
 * drill), and restored into a temporary database of its own on the same
 * database server (never the live or the demo site's database). Every table's
 * row count and every file's checksum are compared with the backup's manifest;
 * then the temporary database is dropped. Without the recovery key it checks
 * every file's checksum only, and says the full drill needs the key. The result
 * goes to the owner's inbox and Telegram.
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
  mode: "full";
  backup: string;
  backupAt: string;
  downloadedBytes: number;
  tables: number;
  migrations: number;
  newestMigration: string | null;
  counts: Record<string, { backup: number; now: number }>;
  /** Every record and file the backup's manifest lists, against what came back (v6.4 backups). */
  records: { expected: number; back: number } | null;
  files: { expected: number; back: number } | null;
  /** Every journal entry's debits equal its credits in the restored copy. */
  ledgerBalanced: boolean;
  mediaFiles: number | null;
  /** The code at the backup's version (G15): "whole", what is wrong with it, or null when the backup has none. */
  code: string | null;
  problems: string[];
  seconds: number;
};

function quoteIdent(name: string) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe database name ${name}`);
  return `"${name}"`;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drops a temporary database. A plain DROP first: Postgres itself stops an
 * autovacuum worker that has just started on the fresh copy, which "WITH
 * (FORCE)" may not do for the app's own (not superuser) database user. Tried a
 * few times, then once more with FORCE for a connection left open.
 */
async function dropTestDatabase(name: string) {
  const sql = `DROP DATABASE IF EXISTS ${quoteIdent(name)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(sql);
      return;
    } catch (error) {
      if (attempt >= 5) {
        await prisma.$executeRawUnsafe(`${sql} WITH (FORCE)`).catch(() => {
          throw error;
        });
        return;
      }
      await pause(1000 * attempt);
    }
  }
}

/** Drops temporary databases a stopped test left behind. */
async function dropLeftovers() {
  const rows = await prisma.$queryRaw<Array<{ datname: string }>>`
    SELECT datname FROM pg_database WHERE datname LIKE ${`${TEST_DB_PREFIX}%`}`;
  for (const { datname } of rows) {
    if (!datname.startsWith(TEST_DB_PREFIX)) continue;
    await dropTestDatabase(datname);
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

/** Every table's row count in a restored copy (the same query as the backup's). */
async function countIn(env: NodeJS.ProcessEnv): Promise<Record<string, number>> {
  const out = await psql(
    env,
    `SELECT table_name || '|' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const tables: Record<string, number> = {};
  for (const line of out.split("\n").filter(Boolean)) {
    const at = line.lastIndexOf("|");
    tables[line.slice(0, at)] = Number(line.slice(at + 1));
  }
  return tables;
}

/**
 * Runs the restore drill now (G11). The scheduler runs it once a month (no
 * actor); "Run drill now" on the Backups screen returns at once with the run.
 * The recovery key typed there is used for this drill only and never kept.
 */
export async function runTestRestore(
  options: {
    trigger: BackupTrigger;
    actor?: Actor | null;
    wait?: boolean;
    recoveryKey?: string | null;
  },
  meta?: RequestMeta,
) {
  const config = await getBackupConfig();
  if (!config.credentialsRef) throw new AppError("CONFLICT", "Connect Google Drive first.");
  const actor = options.actor ?? null;
  const run = await claimRun(options.trigger, actor, "TEST_RESTORE");
  await audit(actor, meta, {
    action: "CREATE",
    entityType: "BackupRun",
    entityId: run.id,
    summary: `${options.trigger === "MANUAL" ? "Started" : "Scheduled"} a restore drill into a temporary database${options.recoveryKey ? " (recovery key typed for this drill)" : ""}`,
  });
  const job = drill(run.id, options.recoveryKey ?? null).catch((error: unknown) =>
    console.error("[backups] restore drill failed", error),
  );
  if (options.wait ?? options.trigger === "SCHEDULED") await job;
  return getBackupRun(run.id);
}

const FULL_NEEDS_KEY =
  "The full drill needs your recovery key: keep it in Google Drive, or type it in Run drill now.";

async function drill(runId: string, typedKey: string | null) {
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
    const folder = { id: newest.folderId, name: newest.name };
    // Room to download and open it (G7): twice its size and a margin, else skipped.
    await needRoom(backupRoot(), newest.bytes ?? 0, "restore drill");

    // The keys: the one typed for this drill, else the one kept in Drive; v6.3's for its backups.
    const recoveryKey = typedKey ?? (await recoveryKeyFromDrive(config).catch(() => null)) ?? null;
    const legacy = currentKey(config)?.key ?? null;
    const ownKeyFile = config.lockedKeyFile ? [parseKeyFile(config.lockedKeyFile)] : [];
    const isPublic = newest.format === 3;
    if ((isPublic && !recoveryKey) || (!isPublic && !legacy && !recoveryKey)) {
      const checked = await checkBackupFiles(token, folder, work);
      const report = {
        mode: "checksums" as const,
        backup: newest.name,
        backupAt: checked.manifest.createdAt,
        files: checked.files,
        downloadedBytes: checked.bytes,
        problems: checked.problems,
        note: FULL_NEEDS_KEY,
        seconds: Math.round((Date.now() - started) / 1000),
      };
      const failed = checked.problems.length > 0;
      await prisma.backupRun.update({
        where: { id: runId },
        data: {
          status: failed ? "FAILED" : "SUCCEEDED",
          finishedAt: new Date(),
          report: report as unknown as Prisma.InputJsonObject,
          error: failed ? checked.problems.join(" ") : null,
        },
      });
      await alertOwner(
        failed ? "Restore drill failed" : "Restore drill: checksums only",
        failed
          ? `The ${newest.name} backup in Google Drive is not whole: ${checked.problems.join(" ")}`
          : `All ${checked.files} files of the ${newest.name} backup are whole in Google Drive. ${FULL_NEEDS_KEY}`,
        runId,
      );
      return;
    }

    const fetched = await fetchBackup(token, folder, work, {
      recoveryKey,
      legacy,
      keyFiles: ownKeyFile,
    });
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
    const restoredTables = await countIn(env);
    const tables = Object.keys(restoredTables).length;
    const migrations = Number(await psql(env, 'SELECT count(*) FROM "_prisma_migrations"'));
    const newestMigration =
      (await psql(
        env,
        'SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name DESC LIMIT 1',
      )) || null;
    const counts: TestRestoreReport["counts"] = {};
    for (const table of COUNTED) {
      counts[table] = {
        backup: restoredTables[table] ?? 0,
        now: await liveCount(table).catch(() => 0),
      };
    }
    const unbalanced = Number(
      await psql(
        env,
        'SELECT count(*) FROM (SELECT "entryId" FROM "JournalLine" GROUP BY "entryId" HAVING sum(debit) <> sum(credit)) x',
      ),
    );
    let restoredFiles: UploadFile[] | null = null;
    let mediaFiles: number | null = null;
    if (fetched.media) {
      const unpacked = path.join(work, "files");
      await mkdir(unpacked, { recursive: true });
      await exec("tar", ["-xzf", fetched.media, "-C", unpacked], LONG_JOB);
      restoredFiles = await listFiles(unpacked);
      mediaFiles = restoredFiles.length;
    }
    // The code inside it: whole, and the backup's version (G15).
    const codeProblem = fetched.code
      ? await checkCodeBundle(fetched.code, fetched.manifest.commit ?? null)
      : null;
    // A v6.4 backup lists every table and file: compare them all, exactly.
    const compared = fetched.manifest.tables
      ? compareContents(
          { tables: fetched.manifest.tables, files: fetched.manifest.uploads ?? [] },
          { tables: restoredTables, files: restoredFiles ?? [] },
        )
      : null;
    const report: TestRestoreReport = {
      mode: "full",
      backup: newest.name,
      backupAt: fetched.manifest.createdAt,
      downloadedBytes: newest.bytes ?? 0,
      tables,
      migrations,
      newestMigration,
      counts,
      records: compared ? { expected: compared.records, back: totalRecords(restoredTables) } : null,
      files: compared ? { expected: compared.files, back: mediaFiles ?? 0 } : null,
      ledgerBalanced: unbalanced === 0,
      mediaFiles,
      code: fetched.code ? (codeProblem ?? "whole") : null,
      problems: compared?.problems ?? [],
      seconds: Math.round((Date.now() - started) / 1000),
    };
    const problems = [
      ...(tables < 10 ? [`only ${tables} tables came back`] : []),
      ...((restoredTables.Company ?? 0) === 0 ? ["no company came back"] : []),
      ...(unbalanced > 0 ? [`${unbalanced} journal entries do not balance`] : []),
      ...(codeProblem ? [codeProblem] : []),
      ...(compared?.problems.slice(0, 20) ?? []),
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
    const summary = compared
      ? `All ${compared.records} records and ${compared.files} files are back (${newest.name}, ${report.seconds} seconds).`
      : `${newest.name}: ${tables} tables, ${counts.Company!.backup} companies, ${counts.SalesOrder!.backup} sales orders, ${counts.Invoice!.backup} invoices${mediaFiles !== null ? `, ${mediaFiles} files` : ""}, in ${report.seconds} seconds.`;
    if (problems.length) {
      await alertOwner("Restore drill failed", `${problems.join("; ")} (${newest.name})`, runId);
    } else {
      await alertOwner(
        "Restore drill worked",
        `The newest backup restored into a temporary database, which was then deleted. ${summary}`,
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
    if (error instanceof NoRoomError) {
      await alertOwner(
        "Restore drill skipped: the server's disk is nearly full",
        `The restore drill did not run. ${error.message}`,
        runId,
      );
    } else {
      await alertOwner(
        "Restore drill failed",
        `${backupName ? `The ${backupName} backup` : "The newest backup"} could not be restored into a temporary database: ${reasonFor(error)}`,
        runId,
      );
    }
  } finally {
    if (created) {
      await dropTestDatabase(database).catch((error: unknown) =>
        console.error("[backups] could not drop the test database", error),
      );
    }
    await rm(work, { recursive: true, force: true });
  }
}
