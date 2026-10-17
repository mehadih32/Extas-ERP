import { readFile, statfs } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import { connect } from "node:tls";

import { prisma } from "@/lib/prisma";
import { readBackupConfig } from "@/modules/backups/backup-core";
import { backupRoot } from "@/modules/backups/backup.service";
import { backupHealth } from "@/modules/backups/status";
import { uploadRoot } from "@/modules/files/file.service";
import { STALE_AFTER_MS } from "@/modules/jobs/queue";

/*
 * Server Health, the checks: made in code, so they cost nothing. Memory and
 * disk of the server, how quickly the database answers, the last backup, the
 * https certificate, failures of the last week and jobs stuck in the queue.
 * Each gives OK, WARN or ERROR (or SKIPPED when it cannot apply here), a line
 * in English for the screen and one in Bengali for the report.
 */

export type HealthLevel = "OK" | "WARN" | "ERROR" | "SKIPPED";

export type HealthKey =
  "memory" | "disk" | "database" | "backups" | "certificate" | "errors" | "jobs";

export type HealthCheck = {
  key: HealthKey;
  label: string;
  level: HealthLevel;
  detail: string;
  /** The same in Bengali (Western digits), for the report. */
  bn: string;
};

export const HEALTH_LABELS: Record<HealthKey, string> = {
  memory: "Memory",
  disk: "Disk space",
  database: "Database speed",
  backups: "Backups",
  certificate: "HTTPS certificate",
  errors: "Errors this week",
  jobs: "Stuck jobs",
};

const RANK: Record<HealthLevel, number> = { SKIPPED: 0, OK: 1, WARN: 2, ERROR: 3 };

export function worstOf(checks: readonly HealthCheck[]): "OK" | "WARN" | "ERROR" {
  const worst = checks.reduce<HealthLevel>((w, c) => (RANK[c.level] > RANK[w] ? c.level : w), "OK");
  return worst === "SKIPPED" ? "OK" : worst;
}

const result = (key: HealthKey, level: HealthLevel, detail: string, bn: string): HealthCheck => ({
  key,
  label: HEALTH_LABELS[key],
  level,
  detail,
  bn,
});

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
/** A size in MB below 1 GB, so a small database does not read "0.0 GB". */
const size = (bytes: number) =>
  bytes < 1024 ** 3 ? `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB` : gb(bytes);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;

/** What the server measures; tests give their own. */
export type Probes = {
  memory: () => Promise<{ used: number; total: number }>;
  disks: () => Promise<Array<{ path: string; free: number; total: number }>>;
  certificate: (host: string) => Promise<Date>;
  appUrl: () => string;
};

async function cgroupMemory(): Promise<{ used: number; total: number } | null> {
  try {
    const [max, current] = await Promise.all([
      readFile("/sys/fs/cgroup/memory.max", "utf8"),
      readFile("/sys/fs/cgroup/memory.current", "utf8"),
    ]);
    const total = Number(max.trim());
    const used = Number(current.trim());
    return Number.isFinite(total) && Number.isFinite(used) && total > 0 ? { used, total } : null;
  } catch {
    return null;
  }
}

export const serverProbes: Probes = {
  async memory() {
    // Inside Docker the container's own limit counts, when it has one.
    return (await cgroupMemory()) ?? { used: totalmem() - freemem(), total: totalmem() };
  },
  async disks() {
    const paths = [...new Set([uploadRoot(), backupRoot()])];
    const out: Array<{ path: string; free: number; total: number }> = [];
    for (const path of paths) {
      try {
        const s = await statfs(path);
        out.push({ path, free: s.bavail * s.bsize, total: s.blocks * s.bsize });
      } catch {
        // A folder that does not exist yet has nothing to measure.
      }
    }
    return out;
  },
  certificate(host) {
    return new Promise<Date>((resolve, reject) => {
      const socket = connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.valid_to) reject(new Error("no certificate"));
        else resolve(new Date(cert.valid_to));
      });
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("timed out"));
      });
      socket.on("error", reject);
    });
  },
  appUrl: () => process.env.APP_URL ?? "",
};

export async function checkMemory(probes: Probes): Promise<HealthCheck> {
  const { used, total } = await probes.memory();
  const share = total > 0 ? used / total : 0;
  const line = `${gb(used)} of ${gb(total)} in use (${pct(share)}).`;
  if (share >= 0.97)
    return result(
      "memory",
      "ERROR",
      `Almost full: ${line}`,
      `মেমরি প্রায় ভর্তি: ${pct(share)} ব্যবহার হচ্ছে (${gb(used)} / ${gb(total)})।`,
    );
  if (share >= 0.9)
    return result("memory", "WARN", `High: ${line}`, `মেমরি বেশি ব্যবহার হচ্ছে: ${pct(share)}।`);
  return result("memory", "OK", line, `মেমরি ঠিক আছে (${pct(share)} ব্যবহার)।`);
}

export async function checkDisk(probes: Probes): Promise<HealthCheck> {
  const disks = await probes.disks();
  if (disks.length === 0) {
    return result("disk", "SKIPPED", "No storage folder to measure here.", "ডিস্ক মাপা যায়নি।");
  }
  const tightest = disks.reduce((a, b) => (a.free / a.total <= b.free / b.total ? a : b));
  const share = tightest.total > 0 ? tightest.free / tightest.total : 0;
  const line = `${gb(tightest.free)} free of ${gb(tightest.total)} (${pct(share)}).`;
  if (share < 0.05)
    return result(
      "disk",
      "ERROR",
      `Almost full: ${line}`,
      `ডিস্ক প্রায় ভর্তি: মাত্র ${gb(tightest.free)} খালি (${pct(share)})।`,
    );
  if (share < 0.15)
    return result(
      "disk",
      "WARN",
      `Getting full: ${line}`,
      `ডিস্ক ভরে আসছে: ${gb(tightest.free)} খালি (${pct(share)})।`,
    );
  return result("disk", "OK", line, `ডিস্কে যথেষ্ট জায়গা আছে (${gb(tightest.free)} খালি)।`);
}

export async function checkDatabase(): Promise<HealthCheck> {
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const ms = Date.now() - started;
  const [long] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM pg_stat_activity
    WHERE datname = current_database() AND state = 'active'
      AND pid <> pg_backend_pid() AND now() - query_start > interval '60 seconds'`;
  const [dbSize] = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
    SELECT pg_database_size(current_database())::bigint AS bytes`;
  const slow = Number(long?.n ?? 0);
  const line = `Answers in ${ms} ms; ${slow} ${slow === 1 ? "query" : "queries"} running over a minute; size ${size(Number(dbSize?.bytes ?? 0))}.`;
  if (ms > 2000)
    return result(
      "database",
      "ERROR",
      `Very slow: ${line}`,
      `ডেটাবেস খুব ধীর: উত্তর দিতে ${ms} ms লাগছে।`,
    );
  if (ms > 250 || slow > 0) {
    return result(
      "database",
      "WARN",
      `Slow: ${line}`,
      `ডেটাবেস ধীর: উত্তর ${ms} ms, ${slow}টি কাজ 1 মিনিটের বেশি চলছে।`,
    );
  }
  return result("database", "OK", line, `ডেটাবেস দ্রুত উত্তর দিচ্ছে (${ms} ms)।`);
}

/**
 * The backups, on the owner's own schedule (the Backups screen's line): a
 * failed or late backup, or none yet, is an error; one that is only on this
 * server (not in Google Drive) is a warning. It only reads.
 */
export async function checkBackups(now: Date): Promise<HealthCheck> {
  const config = await readBackupConfig();
  if (config && !config.isEnabled) {
    return result(
      "backups",
      "WARN",
      "Backups are switched off.",
      "ব্যাকআপ বন্ধ আছে। “Settings > Backups” এ চালু করুন।",
    );
  }
  const health = config ? await backupHealth(config, now) : null;
  if (!health || (!health.lastBackupAt && health.problem?.kind !== "failed")) {
    return result(
      "backups",
      "ERROR",
      "No backup has finished yet.",
      "এখনো কোনো ব্যাকআপ সফল হয়নি।",
    );
  }
  const hours = health.lastBackupAt
    ? Math.floor((now.getTime() - health.lastBackupAt.getTime()) / HOUR)
    : null;
  const age = hours === null ? "" : ` শেষ সফল ব্যাকআপ ${hours} ঘণ্টা আগের।`;
  if (health.problem?.kind === "failed") {
    return result("backups", "ERROR", health.line, `শেষ ব্যাকআপ ব্যর্থ হয়েছে।${age}`);
  }
  if (health.problem?.kind === "late") {
    return result(
      "backups",
      "ERROR",
      health.line,
      `সময়মতো ব্যাকআপ শুরু হয়নি: সার্ভার চলছে কিনা দেখুন।${age}`,
    );
  }
  if (health.level === "good") {
    return result(
      "backups",
      "OK",
      health.line,
      `ব্যাকআপ ঠিক আছে (শেষটি ${hours} ঘণ্টা আগে, Google Drive-এ রাখা)।`,
    );
  }
  return result(
    "backups",
    "WARN",
    health.line,
    `শেষ ব্যাকআপ শুধু এই সার্ভারে আছে, Google Drive-এ যায়নি।${age}`,
  );
}

export async function checkCertificate(probes: Probes, now: Date): Promise<HealthCheck> {
  let host: string;
  try {
    const url = new URL(probes.appUrl());
    if (url.protocol !== "https:") throw new Error("not https");
    host = url.hostname;
  } catch {
    return result(
      "certificate",
      "SKIPPED",
      "The site does not run on https here.",
      "এখানে https নেই, তাই সার্টিফিকেট দেখা হয়নি।",
    );
  }
  try {
    const until = await probes.certificate(host);
    const days = Math.floor((until.getTime() - now.getTime()) / DAY);
    const line = `${host}: valid for ${days} more days.`;
    if (days < 3)
      return result("certificate", "ERROR", line, `HTTPS সার্টিফিকেট ${days} দিনের মধ্যে শেষ হবে।`);
    if (days < 14)
      return result(
        "certificate",
        "WARN",
        line,
        `HTTPS সার্টিফিকেট ${days} দিনে শেষ হবে; Caddy নিজে নতুন করার কথা।`,
      );
    return result("certificate", "OK", line, `HTTPS সার্টিফিকেট আরও ${days} দিন চলবে।`);
  } catch (error) {
    const why = error instanceof Error ? error.message : "no answer";
    return result(
      "certificate",
      "WARN",
      `${host}: could not be checked (${why}).`,
      `HTTPS সার্টিফিকেট দেখা যায়নি (${why})।`,
    );
  }
}

export async function checkErrors(now: Date): Promise<HealthCheck> {
  const since = new Date(now.getTime() - 7 * DAY);
  const [jobs, messages, ai, bot] = await Promise.all([
    prisma.backgroundJob.count({ where: { status: "FAILED", finishedAt: { gte: since } } }),
    prisma.notificationLog.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    prisma.aiUsage.count({ where: { result: "FAILED", createdAt: { gte: since } } }),
    prisma.aiBotMessage.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
  ]);
  const total = jobs + messages + ai + bot;
  const line = `${jobs} failed jobs, ${messages} failed messages, ${ai} failed AI calls, ${bot} failed bot messages.`;
  const bn = `গত 7 দিনে: ${jobs}টি কাজ, ${messages}টি বার্তা, ${ai}টি এআই কল ও ${bot}টি বটের বার্তা ব্যর্থ হয়েছে।`;
  if (total > 50) return result("errors", "ERROR", line, bn);
  if (total > 0) return result("errors", "WARN", line, bn);
  return result("errors", "OK", "Nothing failed this week.", "গত 7 দিনে কিছু ব্যর্থ হয়নি।");
}

export async function checkJobs(now: Date): Promise<HealthCheck> {
  const [stuck, waiting] = await Promise.all([
    prisma.backgroundJob.count({
      where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
    }),
    prisma.backgroundJob.count({
      where: { status: "QUEUED", runAfter: { lt: new Date(now.getTime() - 30 * 60_000) } },
    }),
  ]);
  const line = `${stuck} stuck while running, ${waiting} waiting over 30 minutes.`;
  const bn = `${stuck}টি কাজ চলতে চলতে আটকে আছে, ${waiting}টি 30 মিনিটের বেশি অপেক্ষায়।`;
  if (stuck + waiting > 20) return result("jobs", "ERROR", line, bn);
  if (stuck + waiting > 0) return result("jobs", "WARN", line, bn);
  return result("jobs", "OK", "No job is stuck.", "কোনো কাজ আটকে নেই।");
}

/** All the checks, each on its own: one that fails to run is an ERROR, never a crash. */
export async function runChecks(probes: Probes = serverProbes, now: Date = new Date()) {
  const steps: Array<[HealthKey, () => Promise<HealthCheck>]> = [
    ["memory", () => checkMemory(probes)],
    ["disk", () => checkDisk(probes)],
    ["database", () => checkDatabase()],
    ["backups", () => checkBackups(now)],
    ["certificate", () => checkCertificate(probes, now)],
    ["errors", () => checkErrors(now)],
    ["jobs", () => checkJobs(now)],
  ];
  const out: HealthCheck[] = [];
  for (const [key, run] of steps) {
    try {
      out.push(await run());
    } catch (error) {
      const why = error instanceof Error ? error.message.slice(0, 200) : "failed";
      out.push(
        result(key, "ERROR", `The check could not run (${why}).`, `এই চেক চালানো যায়নি (${why})।`),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------- the safe fixes

export type FixKey = "jobs" | "clean" | "analyze";

export const FIX_LABELS: Record<FixKey, string> = {
  jobs: "Run stuck and failed jobs again",
  clean: "Run the nightly clean-up now",
  analyze: "Refresh the database statistics",
};

/** The safe fixes that suit what the checks found (one owner click each). */
export function fixesFor(checks: readonly HealthCheck[]): FixKey[] {
  const level = (key: HealthKey) => checks.find((c) => c.key === key)?.level ?? "OK";
  const bad = (key: HealthKey) => level(key) === "WARN" || level(key) === "ERROR";
  const out: FixKey[] = [];
  if (bad("jobs") || bad("errors")) out.push("jobs");
  if (bad("disk")) out.push("clean");
  if (bad("database")) out.push("analyze");
  return out;
}
