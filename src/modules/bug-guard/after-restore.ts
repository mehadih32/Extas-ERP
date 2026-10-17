import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { backupRoot } from "@/modules/backups/backup-core";

import { startBugGuard } from "./runner";
import type { Check, CheckResult } from "./types";

/*
 * Bug Guard after a restore on a new server (G1). bootstrap.sh runs
 * deploy/bug-guard.sh --after-restore once the restored ERP is up; it leaves
 * BACKUP_DIR/bug-guard-request.json, and the ERP's clock (clock.ts) takes it
 * once: Bug Guard runs on every company, only reading, and reports to the inbox
 * and Telegram as after every run. What it found goes to
 * BACKUP_DIR/bug-guard-result.json for the script to print.
 */

export const AFTER_RESTORE_REQUEST = "bug-guard-request.json";
export const AFTER_RESTORE_RESULT = "bug-guard-result.json";

export type AfterRestoreCompany = {
  name: string;
  status: "DONE" | "FAILED" | "NOT_RUN";
  urgent: number;
  important: number;
  later: number;
  failedChecks: number;
  note?: string;
};

export type AfterRestoreResult = {
  requestedAt: string;
  finishedAt: string;
  /** Every company was checked, and every check finished. */
  ok: boolean;
  companies: AfterRestoreCompany[];
};

/** Takes the server's request, if there is one; null otherwise. */
async function takeRequest(): Promise<{ requestedAt: string } | null> {
  const file = path.join(backupRoot(), AFTER_RESTORE_REQUEST);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }
  // Taken once, even if the run below stops.
  await rm(file, { force: true });
  try {
    const asked = JSON.parse(text) as { requestedAt?: unknown };
    return typeof asked.requestedAt === "string" ? { requestedAt: asked.requestedAt } : null;
  } catch {
    return null;
  }
}

/**
 * Runs Bug Guard on every company when the server asked for it after a
 * restore. Null when nothing was asked. `checks` only for the tests.
 */
export async function bugGuardAfterRestore(
  options: { checks?: readonly Check[] } = {},
): Promise<AfterRestoreResult | null> {
  const asked = await takeRequest();
  if (!asked) return null;
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const results: AfterRestoreCompany[] = [];
  for (const company of companies) {
    try {
      const started = await startBugGuard(company.id, "NOW", null, {
        wait: true,
        // GitHub's Full check is for the live site; this one may not be it yet.
        fullCheck: false,
        checks: options.checks,
      });
      const run = await prisma.bugGuardRun.findUniqueOrThrow({ where: { id: started.id } });
      const checks = (run.checks as unknown as CheckResult[] | null) ?? [];
      results.push({
        name: company.name,
        status: run.status === "DONE" ? "DONE" : "FAILED",
        urgent: run.urgent,
        important: run.important,
        later: run.later,
        failedChecks: checks.filter((c) => c.status === "FAILED").length,
        ...(run.status === "DONE" ? {} : { note: run.note ?? "The check stopped." }),
      });
    } catch (error) {
      results.push({
        name: company.name,
        status: "NOT_RUN",
        urgent: 0,
        important: 0,
        later: 0,
        failedChecks: 0,
        note: error instanceof AppError ? error.message : "Bug Guard could not start.",
      });
    }
  }
  const result: AfterRestoreResult = {
    requestedAt: asked.requestedAt,
    finishedAt: new Date().toISOString(),
    ok: results.every((r) => r.status === "DONE" && r.failedChecks === 0),
    companies: results,
  };
  const file = path.join(backupRoot(), AFTER_RESTORE_RESULT);
  await writeFile(`${file}.new`, JSON.stringify(result, null, 2));
  await rename(`${file}.new`, file);
  return result;
}
