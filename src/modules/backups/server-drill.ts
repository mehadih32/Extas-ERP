import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { type Actor, audit, getBackupConfig } from "@/modules/backups/backup-core";
import { type DrillResult, onDrill, readDrill } from "@/modules/backups/standby";

/*
 * The restore drill on a new server (the restore guide's "Practice: a restore
 * drill", owner's item 12), as the Backups screens show it:
 *   - on the drill copy itself: its own time and result, from its mark
 *     (BACKUP_DIR/.drill, written by deploy/bootstrap.sh --drill); the copy
 *     answers GET /api/backups/drill with them (no secret, nothing else);
 *   - on the real ERP: "Last new-server drill", recorded when the owner types the
 *     drill copy's web address ("Record a drill"). The real ERP only reads that
 *     answer, over HTTPS, and keeps it only when the drill restored one of its
 *     own backups. Nothing is sent to the drill copy and nothing changes there.
 */

const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const ANSWER_LIMIT = 10_000;

export const DRILL_PATH = "/api/backups/drill";

/**
 * What a drill copy answers at /api/backups/drill: its time and result, dates as
 * text. Not how many records and files it holds: that stays on its own screen.
 */
export function drillAnswer(drill: DrillResult) {
  return {
    address: drill.address,
    startedAt: drill.startedAt?.toISOString() ?? null,
    finishedAt: drill.finishedAt?.toISOString() ?? null,
    seconds: drill.seconds,
    backup: drill.backup,
    problems: drill.problems,
    screenProblems: drill.screenProblems,
    https: drill.https,
    result: drill.result,
  };
}

/** A web address as typed ("https://Drill.example.com/"), as a plain host name. */
export function plainAddress(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export const recordDrillSchema = z.object({
  address: z
    .string()
    .trim()
    .min(1, "Type the drill copy's web address.")
    .max(260)
    .transform(plainAddress)
    .refine((a) => DOMAIN.test(a), "Type a web address like drill.yourcompany.com."),
});

/** Asks a drill copy for its result; the stand-in for tests replaces it. */
type Fetcher = (url: string) => Promise<{ status: number; text: string }>;

const httpsFetcher: Fetcher = async (url) => {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, text: (await response.text()).slice(0, ANSWER_LIMIT + 1) };
};

let fetcher: Fetcher = httpsFetcher;

/** Tests answer for the drill copy (null puts the real one back). */
export function standInForDrillCopy(stand: Fetcher | null) {
  fetcher = stand ?? httpsFetcher;
}

/** The last recorded drill on a new server, as the screen shows it (null: none yet). */
export function presentServerDrill(value: Prisma.JsonValue | null | undefined) {
  const drill = readDrill(value);
  if (!drill?.result || !drill.finishedAt) return null;
  const raw = value as Record<string, unknown>;
  const recordedAt = typeof raw.recordedAt === "string" ? new Date(raw.recordedAt) : null;
  return {
    ...drill,
    recordedAt: recordedAt && !Number.isNaN(recordedAt.getTime()) ? recordedAt : null,
  };
}

/** This ERP's own web address (APP_URL), never a drill's. */
function ownAddress(): string | null {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * "Record a drill": reads the drill copy's result at its web address and keeps
 * it as the last new-server drill. Only on the real ERP, only a finished drill
 * of one of this ERP's own backups; in the audit log.
 */
export async function recordServerDrill(actor: Actor, raw: unknown, meta?: RequestMeta) {
  const { address } = recordDrillSchema.parse(raw ?? {});
  if (await onDrill()) {
    throw new AppError(
      "VALIDATION",
      "This is the drill copy. Record the drill on your real ERP's Backups screen.",
    );
  }
  if (address === ownAddress()) {
    throw new AppError("VALIDATION", "That is this ERP's own address. Type the drill copy's.", {
      address: ["Type the drill copy's address"],
    });
  }
  let answer: { status: number; text: string };
  try {
    answer = await fetcher(`https://${address}${DRILL_PATH}`);
  } catch {
    throw new AppError(
      "UNAVAILABLE",
      `The drill copy at ${address} could not be reached over HTTPS. Check that it still runs and that https://${address} opens in the browser, then try again.`,
    );
  }
  if (answer.status === 404) {
    throw new AppError(
      "VALIDATION",
      `${address} is not a restore drill copy. Type the address you gave the drill (the restore asked “Test web address for this drill”).`,
    );
  }
  let drill: DrillResult | null = null;
  if (answer.status === 200 && answer.text.length <= ANSWER_LIMIT) {
    try {
      drill = readDrill(JSON.parse(answer.text));
    } catch {
      drill = null;
    }
  }
  if (!drill) {
    throw new AppError(
      "UNAVAILABLE",
      `${address} did not answer as a restore drill copy (${answer.status}). Try again in a few minutes.`,
    );
  }
  if (!drill.result || !drill.finishedAt || drill.seconds === null) {
    throw new AppError(
      "VALIDATION",
      `The drill at ${address} has not finished yet. Record it when PuTTY says “Restore drill finished”.`,
    );
  }
  // Only a drill of this ERP's own backup counts.
  const ours =
    drill.backup !== null &&
    (await prisma.backupRun.count({ where: { kind: "BACKUP", name: drill.backup } })) > 0;
  if (!ours) {
    throw new AppError(
      "VALIDATION",
      `The drill copy at ${address} was not restored from one of this ERP's backups, so it was not recorded.`,
    );
  }
  const config = await getBackupConfig();
  const kept = { ...drillAnswer(drill), address, recordedAt: new Date().toISOString() };
  await prisma.backupConfig.update({
    where: { id: config.id },
    data: { lastServerDrill: kept as Prisma.InputJsonObject },
  });
  const minutes = Math.round(drill.seconds / 60);
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Recorded the restore drill on a new server (${address}): ${drill.result === "worked" ? "it worked" : "it had problems"}, ${minutes} min, backup ${drill.backup}`,
  });
  return presentServerDrill(kept as unknown as Prisma.JsonValue);
}
