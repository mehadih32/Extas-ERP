import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { backupRoot } from "@/modules/backups/backup-core";

/*
 * Standby after a restore on a second server (G2). While the web address still
 * points at the old ERP (a practice run, or the old server still in use), the
 * restore command (deploy/bootstrap.sh) leaves BACKUP_DIR/.standby. This copy
 * then never waits on standby without a word: a bar on every page says so. Its
 * backups and alarms run (a failed backup, Bug Guard's urgent items), so a copy
 * that is used after all is never left without them; its backups are marked as
 * made on standby (Enter never picks one in a restore). Its reminders, messages,
 * Mehedi 2.0's clocks and the housekeeping wait, so two ERPs never send them at
 * once. deploy/go-live.sh takes the mark away once the web address reaches this
 * server; they then run within a minute.
 *
 * A restore drill copy (bootstrap.sh --drill, the guide's "Practice: a restore
 * drill") has BACKUP_DIR/.drill, written before the ERP first starts, and stays
 * in test mode for good: no clock runs at all (backups/scheduler.ts,
 * jobs/worker.ts and reminders/scheduler.ts check onDrill first), and nothing
 * leaves it: no emails (mail.service.ts), no bot messages (ai/bot/channel.ts),
 * no Google Drive at all (backup-core.ts driveToken) and no GitHub changes
 * (github/github.ts). go-live.sh and setup-auto-deploy.sh refuse it. The mark
 * also holds the drill's time and result, for the Backups screens.
 */

export const STANDBY_MARK = ".standby";
export const DRILL_MARK = ".drill";

export const STANDBY_LINE =
  "On standby after a restore: the web address does not point to this server yet. Backups and alarms run; reminders and messages wait. When this server is the one to use, run sudo ./deploy/go-live.sh on it.";

const markPath = () => path.join(backupRoot(), STANDBY_MARK);

export const DRILL_LINE =
  "Restore drill copy (test mode): it sends no emails or bot messages, makes no Google Drive backups and runs no scheduled jobs. Delete this server when the drill is done.";

/** Why something was not sent from a drill copy (a refused email, bot message or Drive call). */
export const DRILL_NOT_SENT =
  "Not sent: this is a restore drill copy (test mode), which sends nothing and does not use Google Drive.";

/** A drill as its mark records it: the start until it ends, then its time and result. */
export type DrillResult = {
  address: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  seconds: number | null;
  backup: string | null;
  records: number | null;
  files: number | null;
  problems: number | null;
  screenProblems: number | null;
  https: boolean | null;
  /** Null while the drill still runs. */
  result: "worked" | "problems" | null;
};

const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const date = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** A drill's record from its JSON (the mark, or a drill copy's answer): only known, sane fields. */
export function readDrill(raw: unknown): DrillResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const address = typeof r.address === "string" ? r.address.toLowerCase() : "";
  return {
    address: DOMAIN.test(address) && address.length <= 253 ? address : null,
    startedAt: date(r.startedAt),
    finishedAt: date(r.finishedAt),
    seconds: count(r.seconds),
    backup: typeof r.backup === "string" && /^[\w.:-]{1,120}$/.test(r.backup) ? r.backup : null,
    records: count(r.records),
    files: count(r.files),
    problems: count(r.problems),
    screenProblems: count(r.screenProblems),
    https: typeof r.https === "boolean" ? r.https : null,
    result: r.result === "worked" || r.result === "problems" ? r.result : null,
  };
}

async function exists(name: string): Promise<boolean> {
  try {
    await access(path.join(backupRoot(), name));
    return true;
  } catch {
    return false;
  }
}

/** This copy is a restore drill's (test mode): it sends nothing and runs no clock. */
export async function onDrill(): Promise<boolean> {
  return exists(DRILL_MARK);
}

/** This drill copy's own record (null on any other ERP). */
export async function drillInfo(): Promise<DrillResult | null> {
  let text: string;
  try {
    text = await readFile(path.join(backupRoot(), DRILL_MARK), "utf8");
  } catch {
    return null;
  }
  try {
    return readDrill(JSON.parse(text)) ?? readDrill({});
  } catch {
    // A mark that cannot be read still means a drill copy.
    return readDrill({});
  }
}

/** On standby after a restore (the web address does not point here yet). */
export async function onStandby(): Promise<boolean> {
  return exists(STANDBY_MARK);
}

/**
 * The standby mark: since when, and the id /api/health shows while on standby (from
 * the mark's random words), by which deploy/go-live.sh knows the web address reaches
 * this server and not another one. Null when not on standby.
 */
export async function standbyMark(): Promise<{ since: Date; id: string } | null> {
  try {
    const [info, words] = await Promise.all([stat(markPath()), readFile(markPath())]);
    return { since: info.mtime, id: createHash("sha256").update(words).digest("hex").slice(0, 16) };
  } catch {
    return null;
  }
}
