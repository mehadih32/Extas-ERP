import { localDay, localTime, weekday } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { nextRunAt } from "@/lib/schedule";

import { bugGuardAfterDeploy } from "./after-deploy";
import { bugGuardAfterRestore } from "./after-restore";
import { processCorrections } from "./fixes.service";
import { DEPLOY_MS, startBugGuard, STALE_RUN_MS, takeInFullChecks } from "./runner";
import { ensureSettings, scheduleOf } from "./settings.service";

/*
 * Bug Guard's clock (every minute, from the reminder clock): a run asked for by
 * the server after a restore or an update is started (after-restore.ts,
 * after-deploy.ts); corrections whose
 * backup finished are applied; a Full check that reported back is taken in;
 * Claude Code's merged fixes are checked again once the safe update has run;
 * the owner's schedule starts runs (one at a time on the server); the weekly
 * summary goes out. The schedule and the weekly summary run on the live site
 * only: the demo site checks when asked ("Run now").
 */

const quiet = (error: unknown) => !(error instanceof AppError && error.code === "CONFLICT");

/**
 * On a copy that is not the ERP in use (on standby after a restore, or a drill
 * copy): no Full check on GitHub (it opens the live web address) and no fixes
 * prepared; those are the ERP in use's. Its own checks still run and report.
 */
async function inUseOnly(): Promise<{ fullCheck?: false; prepare?: false }> {
  const { notTheErpInUse } = await import("@/modules/backups/standby");
  return (await notTheErpInUse()) ? { fullCheck: false, prepare: false } : {};
}

export async function runBugGuardClock(now: Date = new Date()) {
  // Asked for by the server after a restore (G1): taken once, not awaited, so
  // the clock goes on while it checks (after-restore.ts).
  void bugGuardAfterRestore().catch((e) => console.error("[bug-guard] after the restore", e));
  // Asked for by deploy.sh after each update of the live site (D5): the same way.
  void bugGuardAfterDeploy().catch((e) => console.error("[bug-guard] after the update", e));
  await processCorrections(now).catch((e) => console.error("[bug-guard] corrections", e));
  await takeInFullChecks(now).catch((e) => console.error("[bug-guard] Full check", e));
  await afterFixes(now).catch((e) => console.error("[bug-guard] after fixes", e));
  if (process.env.DEMO_SITE === "on") return;
  await scheduled(now).catch((e) => console.error("[bug-guard] schedule", e));
  await weekly(now).catch((e) => console.error("[bug-guard] weekly", e));
}

/** Starts the most overdue scheduled run, when no run is going on the server. */
export async function scheduled(now: Date) {
  const companies = await prisma.company.findMany({ select: { id: true } });
  for (const c of companies) await ensureSettings(c.id, now);
  const going = await prisma.bugGuardRun.count({
    where: { status: "RUNNING", startedAt: { gte: new Date(now.getTime() - STALE_RUN_MS) } },
  });
  if (going) return null;
  const due = await prisma.bugGuardSettings.findFirst({
    where: { nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
  });
  if (!due) return null;
  const next = nextRunAt(scheduleOf(due.schedule, now), due.timezone, now);
  // Moved on first, so a run is never started twice for the same time.
  const moved = await prisma.bugGuardSettings.updateMany({
    where: { companyId: due.companyId, nextRunAt: due.nextRunAt },
    data: { nextRunAt: next },
  });
  if (moved.count === 0) return null;
  try {
    return await startBugGuard(due.companyId, "SCHEDULE", null, { now, ...(await inUseOnly()) });
  } catch (error) {
    if (quiet(error)) console.error("[bug-guard] scheduled run not started", error);
    return null;
  }
}

/** The weekly summary on the owner's day and time, once that day. */
export async function weekly(now: Date) {
  const rows = await prisma.bugGuardSettings.findMany();
  const { sendWeekly } = await import("./report");
  for (const s of rows) {
    const today = localDay(now, s.timezone);
    if (weekday(today) !== s.weeklyDay || localTime(now, s.timezone) < s.weeklyTime) continue;
    if (s.weeklySentOn === today) continue;
    const claimed = await prisma.bugGuardSettings.updateMany({
      where: {
        companyId: s.companyId,
        OR: [{ weeklySentOn: null }, { weeklySentOn: { not: today } }],
      },
      data: { weeklySentOn: today },
    });
    if (claimed.count === 0) continue;
    await sendWeekly(s.companyId, now).catch((e) => console.error("[bug-guard] weekly summary", e));
  }
}

/**
 * Claude Code's fixes: one that stopped puts its problem back in the list; one
 * merged is checked again once the safe update has installed it, as is a data
 * correction just applied.
 */
export async function afterFixes(now: Date) {
  const fixing = await prisma.bugGuardFinding.findMany({
    where: { status: "FIXING", requestId: { not: null } },
    select: { id: true, companyId: true, requestId: true, title: true },
    take: 200,
  });
  const requests = new Map(
    (
      await prisma.claudeCodeRequest.findMany({
        where: { id: { in: fixing.map((f) => f.requestId!) } },
        select: { id: true, state: true, mergedAt: true, mergedById: true, note: true },
      })
    ).map((r) => [r.id, r]),
  );
  const recheck = new Map<string, { since: Date; byId: string | null }>();
  for (const f of fixing) {
    const r = requests.get(f.requestId!);
    if (!r || r.state === "STOPPED") {
      await prisma.bugGuardFinding.update({
        where: { id: f.id },
        data: { status: "OPEN", requestId: null, reportedAt: null },
      });
      await prisma.bugGuardEvent.create({
        data: {
          companyId: f.companyId,
          findingId: f.id,
          kind: "REOPENED",
          summary:
            `Claude Code could not finish the fix${r?.note ? ` (${r.note})` : ""}: press Fix again`.slice(
              0,
              500,
            ),
        },
      });
      continue;
    }
    if (r.state === "MERGED" && r.mergedAt && r.mergedAt.getTime() + DEPLOY_MS <= now.getTime()) {
      const since = new Date(r.mergedAt.getTime() + DEPLOY_MS);
      const was = recheck.get(f.companyId);
      if (!was || since < was.since) recheck.set(f.companyId, { since, byId: r.mergedById });
    }
  }
  const applied = await prisma.bugGuardCorrection.findMany({
    where: {
      status: "APPLIED",
      appliedAt: { gte: new Date(now.getTime() - 86_400_000), lte: now },
    },
    select: { companyId: true, appliedAt: true, appliedById: true },
  });
  for (const c of applied) {
    const was = recheck.get(c.companyId);
    if (!was || c.appliedAt! < was.since)
      recheck.set(c.companyId, { since: c.appliedAt!, byId: c.appliedById });
  }
  const options = { now, ...(await inUseOnly()) };
  for (const [companyId, { since, byId }] of recheck) {
    const ran = await prisma.bugGuardRun.count({ where: { companyId, startedAt: { gte: since } } });
    if (ran) continue;
    await startBugGuard(companyId, "AFTER_FIX", byId, options).catch((error: unknown) => {
      if (quiet(error)) console.error("[bug-guard] check after a fix not started", error);
    });
  }
}
