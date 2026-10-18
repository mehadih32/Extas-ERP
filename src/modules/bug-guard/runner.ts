import { type BugGuardFinding, type BugGuardTrigger, Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readOnly } from "@/lib/read-only";

import { ALL_CHECKS } from "./checks";
import { platformCompanyId } from "./security";
import type { Check, CheckResult, Found, Severity } from "./types";

/*
 * One Bug Guard run: every check of the company, each only reading (inside
 * readOnly(), so a check that tried to write would be refused) and each given
 * at most a minute; then what they found is kept, compared with the last run
 * (new, back again, gone, put right), and reported (report.ts). On the
 * platform's own company it also asks GitHub for the Full check (every screen,
 * PDF and the layout checks at four widths), whose findings are taken in when
 * it reports back (takeInFullChecks). One run at a time per company.
 */

export const READ_ONLY_WHY = "Bug Guard only reads while it checks";
export const CHECK_TIMEOUT_MS = 60_000;
/** A run still "checking" after this was cut short by a restart. */
export const STALE_RUN_MS = 30 * 60_000;
/** How long the safe update takes after a merge, before a fix is judged. */
export const DEPLOY_MS = 20 * 60_000;
/** A Full check asked for less than this ago is not asked for again. */
const FULL_CHECK_EVERY_MS = 6 * 60 * 60_000;
const WEEK_MS = 7 * 86_400_000;

const RANK: Record<Severity, number> = { LATER: 1, IMPORTANT: 2, URGENT: 3 };

const json = (value: unknown) =>
  value === undefined || value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

const plain = (error: unknown) =>
  error instanceof AppError
    ? error.message
    : error instanceof Error
      ? error.message.slice(0, 200)
      : "It stopped";

export type RunOptions = {
  now?: Date;
  /** Wait for the run to finish (the clock does not; tests and "Run now" on the bot do). */
  wait?: boolean;
  /** The checks to run (tests); every check by default. */
  checks?: readonly Check[];
  /** Ask GitHub for the Full check too (on by default). */
  fullCheck?: boolean;
  /** Send the report when done (on by default). */
  report?: boolean;
  /**
   * Prepare fixes and corrections by itself when the owner turned that on (on by
   * default). The check after an update only reads and reports: never.
   */
  prepare?: boolean;
  /** Ask for a new Full check even when one ran in the last hours (after an update). */
  freshFullCheck?: boolean;
  /**
   * A run still "checking" that started before this was cut short (the server
   * restarted since: after an update, the app started again).
   */
  staleBefore?: Date;
};

/** Starts a run (throws CONFLICT when one is going). */
export async function startBugGuard(
  companyId: string,
  trigger: BugGuardTrigger,
  startedById: string | null,
  options: RunOptions = {},
) {
  const now = options.now ?? new Date();
  const run = await claim(companyId, trigger, startedById, now, options.staleBefore);
  // Never rejects: an unhandled rejection would stop the server.
  const work = execute(run.id, options).catch(async (error: unknown) => {
    console.error("[bug-guard] run failed", error);
    await prisma.bugGuardRun
      .update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date(), note: plain(error) },
      })
      .catch(() => undefined);
    await prisma.bugGuardEvent
      .create({
        data: {
          companyId,
          runId: run.id,
          kind: "FAILED",
          summary: `The check stopped: ${plain(error)}`,
        },
      })
      .catch(() => undefined);
  });
  if (options.wait) await work;
  return run;
}

async function claim(
  companyId: string,
  trigger: BugGuardTrigger,
  startedById: string | null,
  now: Date,
  staleBefore?: Date,
) {
  const stale = new Date(now.getTime() - STALE_RUN_MS);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`extras-erp:bug-guard:${companyId}`}))`;
    await tx.bugGuardRun.updateMany({
      where: {
        companyId,
        status: "RUNNING",
        startedAt: { lt: staleBefore && staleBefore > stale ? staleBefore : stale },
      },
      data: {
        status: "FAILED",
        finishedAt: now,
        note: "Stopped: the server restarted during the check.",
      },
    });
    const running = await tx.bugGuardRun.findFirst({ where: { companyId, status: "RUNNING" } });
    if (running) {
      throw new AppError(
        "CONFLICT",
        "Bug Guard is checking already: the report comes when it finishes.",
      );
    }
    return tx.bugGuardRun.create({
      data: { companyId, trigger, startedById, startedAt: now, status: "RUNNING" },
    });
  });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError("UNAVAILABLE", `It took over ${ms / 1000} seconds`)),
      ms,
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

type Seen = Found & { check: string };

/** Runs checks (only reading); what each found and how it went. */
export async function runChecks(input: {
  companyId: string;
  now: Date;
  since: Date;
  platform: boolean;
  checks: readonly Check[];
}) {
  const results: CheckResult[] = [];
  const found: Seen[] = [];
  const observed = new Map<string, Date>();
  const keys = new Set<string>();
  for (const check of input.checks) {
    if (check.platform && !input.platform) continue;
    const started = performance.now();
    let observedAt = input.now;
    try {
      const list = await withTimeout(
        readOnly(READ_ONLY_WHY, () =>
          check.run({
            companyId: input.companyId,
            now: input.now,
            since: input.since,
            platform: input.platform,
            db: prisma,
            observed: (at) => {
              observedAt = at;
            },
          }),
        ),
        CHECK_TIMEOUT_MS,
      );
      observed.set(check.key, observedAt);
      const fresh = list.filter((f) => !keys.has(f.key));
      for (const f of fresh) keys.add(f.key);
      found.push(...fresh.map((f) => ({ ...f, check: check.key })));
      results.push({
        key: check.key,
        area: check.area,
        label: check.label,
        status: fresh.length ? "FOUND" : "OK",
        found: fresh.length,
        ms: Math.round(performance.now() - started),
      });
    } catch (error) {
      console.error(`[bug-guard] check ${check.key} failed`, error);
      results.push({
        key: check.key,
        area: check.area,
        label: check.label,
        status: "FAILED",
        found: 0,
        ms: Math.round(performance.now() - started),
        note: plain(error),
      });
    }
  }
  return { results, found, observed };
}

async function execute(runId: string, options: RunOptions) {
  const run = await prisma.bugGuardRun.findUniqueOrThrow({ where: { id: runId } });
  const companyId = run.companyId;
  const now = options.now ?? run.startedAt;
  const platform = (await platformCompanyId()) === companyId;
  const last = await prisma.bugGuardRun.findFirst({
    where: { companyId, status: "DONE", id: { not: run.id }, startedAt: { lte: now } },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  const since = last?.startedAt ?? new Date(now.getTime() - WEEK_MS);
  const notes: string[] = [];

  let fullCheckRunId: string | null = null;
  if (options.fullCheck !== false) {
    const asked = await askFullCheck(companyId, run.startedById, now, options.freshFullCheck);
    fullCheckRunId = asked.id;
    if (asked.note) notes.push(asked.note);
  }

  const { results, found, observed } = await runChecks({
    companyId,
    now,
    since,
    platform,
    checks: options.checks ?? ALL_CHECKS,
  });
  const failed = results.filter((r) => r.status === "FAILED");
  if (failed.length)
    notes.push(
      `${failed.length} check(s) could not finish: ${failed.map((f) => f.label).join(", ")}.`,
    );
  const stored = await storeFindings({
    companyId,
    runId,
    now,
    found,
    ran: results.filter((r) => r.status !== "FAILED" && r.status !== "SKIPPED").map((r) => r.key),
    observed,
  });
  const counts = await openCounts(companyId);
  await prisma.bugGuardRun.update({
    where: { id: runId },
    data: {
      status: "DONE",
      finishedAt: new Date(),
      checks: results as unknown as Prisma.InputJsonArray,
      ...counts,
      newCount: stored.newIds.length + stored.reopenedIds.length,
      fixedCount: stored.fixedIds.length + stored.goneIds.length,
      fullCheckRunId,
      note: notes.join(" ") || null,
    },
  });
  await prisma.bugGuardSettings.updateMany({ where: { companyId }, data: { lastRunAt: now } });
  await prisma.bugGuardEvent.create({
    data: {
      companyId,
      runId,
      kind: "RUN",
      byId: run.startedById,
      summary: `Checked ${results.length} things: ${counts.urgent} urgent, ${counts.important} important, ${counts.later} can wait open; ${stored.newIds.length + stored.reopenedIds.length} new, ${stored.fixedIds.length + stored.goneIds.length} put right.`,
    },
  });
  if (options.prepare !== false) {
    await autoPrepare(companyId, [...stored.newIds, ...stored.reopenedIds]);
  }
  if (options.report !== false) {
    const { reportRun } = await import("./report");
    await reportRun(runId, [...stored.newIds, ...stored.reopenedIds, ...stored.dueIds]);
  }
}

/**
 * Asks GitHub for the Full check, when it is connected and none ran lately
 * (`fresh`: a new one whatever ran before, after an update).
 */
async function askFullCheck(
  companyId: string,
  startedById: string | null,
  now: Date,
  fresh = false,
): Promise<{ id: string | null; note: string | null }> {
  const settings = await prisma.aiSettings.findUnique({
    where: { companyId },
    select: { githubRepo: true, githubTokenSealed: true },
  });
  if (!settings?.githubRepo || !settings.githubTokenSealed) {
    return {
      id: null,
      note: "The Full check was not asked for: GitHub is not connected (AI Center > Full check).",
    };
  }
  const recent = await prisma.fullCheckRun.findFirst({
    where: { companyId, startedAt: { gte: new Date(now.getTime() - FULL_CHECK_EVERY_MS) } },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true },
  });
  if (recent && recent.status !== "FAILED" && !fresh) return { id: recent.id, note: null };
  try {
    const { startFullCheckFor } = await import("@/modules/ai/full-check/full-check.service");
    const started = await startFullCheckFor(companyId, startedById);
    return { id: started.id, note: null };
  } catch (error) {
    return { id: null, note: `The Full check could not be asked for: ${plain(error)}` };
  }
}

export async function openCounts(companyId: string) {
  const rows = await prisma.bugGuardFinding.groupBy({
    by: ["severity"],
    where: { companyId, status: "OPEN" },
    _count: { _all: true },
  });
  const of = (s: Severity) => rows.find((r) => r.severity === s)?._count._all ?? 0;
  return { urgent: of("URGENT"), important: of("IMPORTANT"), later: of("LATER") };
}

type Outcome = {
  newIds: string[];
  reopenedIds: string[];
  /** Snoozed ones whose "remind me later" has come. */
  dueIds: string[];
  fixedIds: string[];
  goneIds: string[];
};

/**
 * Keeps what a run found. The same problem keeps its row (by key):
 *   - new: OPEN, reported;
 *   - gone or put right before, found again: OPEN, reported again;
 *   - ignored: stays ignored, unless it got worse;
 *   - snoozed: quiet until its day, then OPEN and reported again;
 *   - with Claude Code (FIXING): judged only once the fix is merged and the
 *     check read the ERP after the safe update installed it: still there means
 *     OPEN again ("the fix did not put it right"), gone means FIXED.
 * One not found by a check that ran is GONE (FIXED when its fix was merged);
 * one whose check did not finish is left as it is. A correction prepared for
 * one that is gone is STALE.
 */
export async function storeFindings(input: {
  companyId: string;
  runId: string;
  now: Date;
  found: Seen[];
  ran: string[];
  observed: Map<string, Date>;
}): Promise<Outcome> {
  const { companyId, runId, now } = input;
  const out: Outcome = { newIds: [], reopenedIds: [], dueIds: [], fixedIds: [], goneIds: [] };
  const keys = input.found.map((f) => f.key);
  const existing = await prisma.bugGuardFinding.findMany({
    where: {
      companyId,
      OR: [
        { key: { in: keys } },
        { check: { in: input.ran }, status: { in: ["OPEN", "SNOOZED", "FIXING"] } },
      ],
    },
  });
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const requestIds = existing.map((e) => e.requestId).filter((id): id is string => Boolean(id));
  const requests = new Map(
    (
      await prisma.claudeCodeRequest.findMany({
        where: { id: { in: requestIds } },
        select: { id: true, state: true, mergedAt: true },
      })
    ).map((r) => [r.id, r]),
  );
  /** Whether a fix on its way can be judged on what the check read. */
  const judged = (f: BugGuardFinding, check: string) => {
    const r = f.requestId ? requests.get(f.requestId) : null;
    if (!r) return "none" as const;
    if (r.state !== "MERGED" || !r.mergedAt) return "waiting" as const;
    const at = input.observed.get(check) ?? now;
    return at.getTime() >= r.mergedAt.getTime() + DEPLOY_MS
      ? ("merged" as const)
      : ("waiting" as const);
  };
  const events: Prisma.BugGuardEventCreateManyInput[] = [];
  const event = (findingId: string, kind: string, summary: string) =>
    events.push({ companyId, runId, findingId, kind, summary });

  for (const f of input.found) {
    const content = {
      check: f.check,
      area: f.area,
      severity: f.severity,
      title: f.title,
      href: f.href ?? null,
      place: f.place ?? null,
      why: f.why,
      fix: f.fix,
      fixKind: f.fixKind,
      evidence: json(f.evidence),
      correction: json(f.correction),
      action: json(f.action),
      code: json(f.code),
      lastRunId: runId,
      lastSeenAt: now,
    };
    const was = byKey.get(f.key);
    if (!was) {
      const made = await prisma.bugGuardFinding.create({
        data: {
          ...content,
          companyId,
          key: f.key,
          status: "OPEN",
          firstRunId: runId,
          firstSeenAt: now,
        },
        select: { id: true },
      });
      out.newIds.push(made.id);
      event(made.id, "FOUND", f.title.slice(0, 300));
      continue;
    }
    let status = was.status;
    let reopen = false;
    let why = "";
    switch (was.status) {
      case "GONE":
      case "FIXED":
        reopen = true;
        why = "Found again";
        break;
      case "IGNORED":
        if (RANK[f.severity] > RANK[was.severity]) {
          reopen = true;
          why = "Ignored before, but it got worse";
        }
        break;
      case "SNOOZED":
        if (!was.snoozedUntil || was.snoozedUntil <= now) {
          status = "OPEN";
          out.dueIds.push(was.id);
        }
        break;
      case "FIXING": {
        const state = judged(was, f.check);
        if (state === "merged") {
          reopen = true;
          why = "Still there after the fix was merged and installed: the fix did not put it right";
        } else if (state === "none") {
          status = "OPEN";
        }
        break;
      }
      case "OPEN":
        break;
    }
    if (reopen) {
      status = "OPEN";
      out.reopenedIds.push(was.id);
      event(was.id, "REOPENED", `${why}: ${f.title}`.slice(0, 300));
    }
    await prisma.bugGuardFinding.update({
      where: { id: was.id },
      data: {
        ...content,
        status,
        seenCount: { increment: 1 },
        goneAt: null,
        snoozedUntil: status === "SNOOZED" ? was.snoozedUntil : null,
        requestId: status === "FIXING" ? was.requestId : reopen ? null : was.requestId,
        reportedAt: reopen || out.dueIds.includes(was.id) ? null : was.reportedAt,
      },
    });
  }

  const seen = new Set(keys);
  for (const was of existing) {
    if (seen.has(was.key) || !input.ran.includes(was.check)) continue;
    if (!["OPEN", "SNOOZED", "FIXING"].includes(was.status)) continue;
    const state = was.status === "FIXING" ? judged(was, was.check) : "none";
    if (state === "waiting") continue;
    const fixed = state === "merged";
    await prisma.bugGuardFinding.update({
      where: { id: was.id },
      data: { status: fixed ? "FIXED" : "GONE", goneAt: now, snoozedUntil: null },
    });
    (fixed ? out.fixedIds : out.goneIds).push(was.id);
    event(
      was.id,
      fixed ? "FIXED" : "GONE",
      `${fixed ? "Put right by the merged fix" : "Not found any more"}: ${was.title}`.slice(0, 300),
    );
  }
  const ended = [...out.fixedIds, ...out.goneIds];
  if (ended.length) {
    await prisma.bugGuardCorrection.updateMany({
      where: { companyId, findingId: { in: ended }, status: "PREPARED" },
      data: { status: "STALE", error: "The problem is not there any more." },
    });
  }
  if (events.length) await prisma.bugGuardEvent.createMany({ data: events });
  return out;
}

/** The option "open fixes and prepare corrections by itself" (off by default). */
async function autoPrepare(companyId: string, ids: string[]) {
  if (ids.length === 0) return;
  const settings = await prisma.bugGuardSettings.findUnique({
    where: { companyId },
    select: { autoPrepare: true },
  });
  if (!settings?.autoPrepare) return;
  const { prepareByItself } = await import("./fixes.service");
  await prepareByItself(companyId, ids).catch((error: unknown) =>
    console.error("[bug-guard] could not prepare fixes", error),
  );
}

/**
 * The Full check a run asked for reports back from GitHub later: its findings
 * are taken in then (only that check), and the new ones reported. One that
 * never finishes is let go after six hours.
 */
export async function takeInFullChecks(now: Date = new Date()) {
  const waiting = await prisma.bugGuardRun.findMany({
    where: {
      status: "DONE",
      fullCheckRunId: { not: null },
      fullCheckSeenAt: null,
      startedAt: { gte: new Date(now.getTime() - 2 * 86_400_000) },
    },
    orderBy: { startedAt: "asc" },
    take: 10,
  });
  for (const run of waiting) {
    const fc = await prisma.fullCheckRun.findUnique({
      where: { id: run.fullCheckRunId! },
      select: { status: true, startedAt: true, note: true },
    });
    const finished = fc && (fc.status === "DONE" || fc.status === "FAILED");
    const tooOld = now.getTime() - run.startedAt.getTime() > 6 * 60 * 60_000;
    if (!finished && !tooOld && fc) continue;
    const claimed = await prisma.bugGuardRun.updateMany({
      where: { id: run.id, fullCheckSeenAt: null },
      data: { fullCheckSeenAt: now },
    });
    if (claimed.count === 0) continue;
    // The check after an update reports how its Full check ended, whatever it found.
    const afterUpdate = run.trigger === "AFTER_DEPLOY";
    if (fc?.status !== "DONE") {
      if (afterUpdate) {
        const { reportFullCheckFailed } = await import("./report");
        await reportFullCheckFailed(
          run.id,
          fc?.note ?? (fc ? "it sent no report within six hours" : "it is not on record"),
        ).catch((error: unknown) => console.error("[bug-guard] Full check not reported", error));
      }
      continue;
    }
    const fullCheck = ALL_CHECKS.find((c) => c.key === "app.full-check");
    if (!fullCheck) continue;
    try {
      const { results, found, observed } = await runChecks({
        companyId: run.companyId,
        now,
        since: run.startedAt,
        platform: (await platformCompanyId()) === run.companyId,
        checks: [fullCheck],
      });
      const ran = results.filter((r) => r.status !== "FAILED").map((r) => r.key);
      const stored = await storeFindings({
        companyId: run.companyId,
        runId: run.id,
        now,
        found,
        ran,
        observed,
      });
      const counts = await openCounts(run.companyId);
      const before = (run.checks as unknown as CheckResult[]).filter(
        (c) => c.key !== fullCheck.key,
      );
      await prisma.bugGuardRun.update({
        where: { id: run.id },
        data: {
          ...counts,
          checks: [...before, ...results] as unknown as Prisma.InputJsonArray,
          newCount: run.newCount + stored.newIds.length + stored.reopenedIds.length,
          fixedCount: run.fixedCount + stored.fixedIds.length + stored.goneIds.length,
        },
      });
      const fresh = [...stored.newIds, ...stored.reopenedIds];
      if (!afterUpdate) await autoPrepare(run.companyId, fresh);
      const { reportFullCheck } = await import("./report");
      await reportFullCheck(
        run.id,
        fresh,
        stored.fixedIds.length + stored.goneIds.length,
        afterUpdate,
      );
    } catch (error) {
      console.error("[bug-guard] Full check not taken in", error);
    }
  }
}
