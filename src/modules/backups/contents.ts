import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { pgDumpBinary, pgEnvironment } from "@/modules/backups/backup-core";

/*
 * What a backup holds, counted so a restore can prove that everything came
 * back (G3): the row count of every table in the database and the size and
 * checksum of every uploaded and generated file.
 *
 * The counts and the dump come from the same moment: a transaction exports its
 * snapshot, the counts are read inside it, and pg_dump reads that very snapshot
 * (--snapshot). So "All N records are back" can be checked exactly, however
 * busy the ERP was during the backup.
 */

const exec = promisify(execFile);
const LONG_JOB = { timeout: 2 * 60 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 };

export type TableCounts = Record<string, number>;

export type UploadFile = { path: string; bytes: number; sha256: string };

export type Contents = {
  /** Every table in the public schema and its row count, at the moment of the dump. */
  tables: TableCounts;
  /** All rows of all tables. */
  records: number;
  /** Every uploaded and generated file (UPLOAD_DIR), relative path, size and SHA-256. */
  files: UploadFile[];
  fileBytes: number;
};

/** Every table's row count, read in one statement (in the caller's snapshot). */
export async function countTables(
  db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
): Promise<TableCounts> {
  const rows = await db.$queryRaw<Array<{ table_name: string; n: bigint }>>(Prisma.sql`
    SELECT table_name::text AS table_name,
           (xpath('/row/n/text()',
             query_to_xml(format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name),
                          false, true, '')))[1]::text::bigint AS n
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`);
  return Object.fromEntries(rows.map((r) => [r.table_name, Number(r.n)]));
}

export const totalRecords = (tables: TableCounts) =>
  Object.values(tables).reduce((sum, n) => sum + n, 0);

/**
 * pg_dump of the whole database into `file`, and every table's row count at the
 * same moment. The transaction that holds the snapshot stays open until
 * pg_dump has finished.
 */
export async function dumpWithCounts(file: string): Promise<TableCounts> {
  return prisma.$transaction(
    async (tx) => {
      const [{ snapshot }] = await tx.$queryRaw<
        [{ snapshot: string }]
      >`SELECT pg_export_snapshot() AS snapshot`;
      // The server stops idle transactions after 10 minutes; this one waits on pg_dump.
      await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = 0`;
      const tables = await countTables(tx);
      if (!/^[0-9A-F-]+$/i.test(snapshot)) throw new Error("unexpected snapshot name");
      await exec(
        pgDumpBinary(),
        [
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          `--snapshot=${snapshot}`,
          "--file",
          file,
        ],
        { ...LONG_JOB, env: { ...process.env, ...pgEnvironment(process.env.DATABASE_URL ?? "") } },
      );
      return tables;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: LONG_JOB.timeout,
      maxWait: 60_000,
    },
  );
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Every file under `root` (links are not followed), with its size and SHA-256,
 * sorted by path. `skip` is a folder inside it left out (the backups, when
 * BACKUP_DIR sits inside UPLOAD_DIR).
 */
export async function listFiles(root: string, skip?: string): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  async function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (skip && (full === skip || full.startsWith(skip + path.sep))) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const info = await lstat(full);
        out.push({
          path: path.relative(root, full).split(path.sep).join("/"),
          bytes: info.size,
          sha256: await sha256Of(full),
        });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Packs exactly the listed files (and nothing else) into a .tar.gz, paths
 * relative to `root` and starting with "./" as v6.3's archives did. An empty
 * list makes an empty archive, so every backup has one.
 */
export async function packFiles(root: string, files: UploadFile[], to: string): Promise<void> {
  const list = `${to}.list`;
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(list, files.map((f) => `./${f.path}\0`).join(""));
  try {
    await new Promise<void>((resolve, reject) => {
      const args = files.length
        ? ["-czf", to, "-C", root, "--null", "--no-recursion", "-T", list]
        : ["-czf", to, "-T", "/dev/null"];
      const tar = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      tar.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
      tar.on("error", reject);
      tar.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(Object.assign(new Error(`tar failed (${code})`), { stderr })),
      );
    });
  } finally {
    await rm(list, { force: true });
  }
}

/** Reads what a backup holds into one record. */
export function contentsOf(tables: TableCounts, files: UploadFile[]): Contents {
  return {
    tables,
    records: totalRecords(tables),
    files,
    fileBytes: files.reduce((sum, f) => sum + f.bytes, 0),
  };
}

export type Comparison = {
  ok: boolean;
  records: number;
  files: number;
  /** Plain sentences, one per problem. */
  problems: string[];
};

/**
 * Compares what came back with what the backup held: every table's count and
 * every file's checksum. Tables the restored copy has but the backup did not
 * (none, normally) are not a problem.
 */
export function compareContents(
  backup: Pick<Contents, "tables" | "files">,
  restored: { tables: TableCounts; files?: UploadFile[] | null },
): Comparison {
  const problems: string[] = [];
  for (const [table, n] of Object.entries(backup.tables)) {
    const back = restored.tables[table];
    if (back === undefined) problems.push(`Table ${table} is missing (${n} records).`);
    else if (back !== n) problems.push(`Table ${table} has ${back} of ${n} records.`);
  }
  if (restored.files) {
    const byPath = new Map(restored.files.map((f) => [f.path, f]));
    for (const file of backup.files) {
      const back = byPath.get(file.path);
      if (!back) problems.push(`File ${file.path} is missing.`);
      else if (back.sha256 !== file.sha256) problems.push(`File ${file.path} is not the same.`);
    }
  }
  return {
    ok: problems.length === 0,
    records: totalRecords(backup.tables),
    files: backup.files.length,
    problems,
  };
}
