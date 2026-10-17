import { prisma } from "@/lib/prisma";
import { describeSchedule } from "@/lib/schedule";
import type { CompanyContext } from "@/modules/auth/context";

import { ALL_CHECKS } from "./checks";
import { describePlan } from "./corrections";
import { STALE_RUN_MS, startBugGuard } from "./runner";
import { assertPlatform, settingsOf } from "./settings.service";
import type {
  CheckResult,
  CodeFacts,
  CorrectionPlan,
  FixKind,
  SecurityAction,
  Severity,
} from "./types";
import { AREAS, type Area } from "./types";

/*
 * AI Center > Bug Guard (the platform owner only): what the screen shows, and
 * "Run now". Reading changes nothing.
 */

const SEVERITY_ORDER: Record<Severity, number> = { URGENT: 0, IMPORTANT: 1, LATER: 2 };

export async function getBugGuard(ctx: CompanyContext, now: Date = new Date()) {
  assertPlatform(ctx);
  const companyId = ctx.company.id;
  const [settings, runs, findings, corrections, blocks, events, pin] = await Promise.all([
    settingsOf(companyId, now),
    prisma.bugGuardRun.findMany({
      where: { companyId },
      orderBy: { startedAt: "desc" },
      take: 12,
    }),
    prisma.bugGuardFinding.findMany({
      where: {
        companyId,
        OR: [
          { status: { in: ["OPEN", "FIXING", "SNOOZED", "IGNORED"] } },
          { goneAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
        ],
      },
      orderBy: { lastSeenAt: "desc" },
      take: 400,
    }),
    prisma.bugGuardCorrection.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { finding: { select: { title: true } } },
    }),
    prisma.loginBlock.findMany({
      where: {
        OR: [{ companyId }, { companyId: null }],
        liftedAt: null,
        blockedUntil: { gt: now },
      },
      orderBy: { blockedAt: "desc" },
      take: 50,
    }),
    prisma.bugGuardEvent.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 150,
      include: { by: { select: { name: true } } },
    }),
    prisma.aiSettings.findUnique({ where: { companyId }, select: { pinHash: true } }),
  ]);
  const requestIds = findings.map((f) => f.requestId).filter((id): id is string => Boolean(id));
  const requests = new Map(
    (
      await prisma.claudeCodeRequest.findMany({
        where: { id: { in: requestIds } },
        select: {
          id: true,
          state: true,
          issueNumber: true,
          issueUrl: true,
          prNumber: true,
          prUrl: true,
          checks: true,
          prVetted: true,
        },
      })
    ).map((r) => [r.id, r]),
  );
  const userIds = [
    ...new Set(runs.map((r) => r.startedById).filter((id): id is string => Boolean(id))),
  ];
  const users = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const running = runs.find(
    (r) => r.status === "RUNNING" && now.getTime() - r.startedAt.getTime() < STALE_RUN_MS,
  );
  const lastDone = runs.find((r) => r.status === "DONE") ?? null;

  const shown = findings.map((f) => ({
    id: f.id,
    key: f.key,
    area: f.area as Area,
    severity: f.severity as Severity,
    status: f.status,
    title: f.title,
    href: f.href,
    place: f.place,
    why: f.why,
    fix: f.fix,
    fixKind: f.fixKind as FixKind,
    evidence: (f.evidence as Array<{ label: string; value: string }> | null) ?? [],
    correctionText: f.correction ? describePlan(f.correction as unknown as CorrectionPlan) : null,
    action: (f.action as SecurityAction | null) ?? null,
    hasCode: Boolean((f.code as CodeFacts | null)?.route),
    snoozedUntil: f.snoozedUntil,
    firstSeenAt: f.firstSeenAt,
    lastSeenAt: f.lastSeenAt,
    goneAt: f.goneAt,
    seenCount: f.seenCount,
    request: f.requestId ? (requests.get(f.requestId) ?? null) : null,
    openCorrection:
      corrections.find((c) => c.findingId === f.id && ["PREPARED", "BACKING_UP"].includes(c.status))
        ?.id ?? null,
  }));
  shown.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
  );

  return {
    settings: {
      ...settings,
      scheduleText: describeSchedule(settings.schedule),
    },
    pinSet: Boolean(pin?.pinHash),
    running: running ? { id: running.id, startedAt: running.startedAt } : null,
    last: lastDone
      ? {
          id: lastDone.id,
          startedAt: lastDone.startedAt,
          finishedAt: lastDone.finishedAt,
          trigger: lastDone.trigger,
          by: lastDone.startedById
            ? (users.get(lastDone.startedById) ?? "Someone")
            : "Bug Guard (schedule)",
          urgent: lastDone.urgent,
          important: lastDone.important,
          later: lastDone.later,
          newCount: lastDone.newCount,
          fixedCount: lastDone.fixedCount,
          checks: (lastDone.checks as unknown as CheckResult[]) ?? [],
          note: lastDone.note,
          fullCheckWaiting: Boolean(lastDone.fullCheckRunId && !lastDone.fullCheckSeenAt),
        }
      : null,
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      by: r.startedById ? (users.get(r.startedById) ?? "Someone") : "Bug Guard",
      urgent: r.urgent,
      important: r.important,
      later: r.later,
      newCount: r.newCount,
      fixedCount: r.fixedCount,
      note: r.note,
    })),
    open: shown.filter((f) => f.status === "OPEN"),
    fixing: shown.filter((f) => f.status === "FIXING"),
    waiting: shown.filter((f) => f.status === "SNOOZED" || f.status === "IGNORED"),
    done: shown.filter((f) => f.status === "FIXED" || f.status === "GONE").slice(0, 60),
    corrections: corrections.map((c) => ({
      id: c.id,
      findingId: c.findingId,
      title: c.finding.title,
      summary: c.summary,
      status: c.status,
      error: c.error,
      preparedByGuard: c.preparedByGuard,
      createdAt: c.createdAt,
      appliedAt: c.appliedAt,
      undoneAt: c.undoneAt,
      journalEntryId: c.journalEntryId,
    })),
    blocks: blocks.map((b) => ({
      id: b.id,
      source: b.source,
      reason: b.reason,
      blockedAt: b.blockedAt,
      blockedUntil: b.blockedUntil,
    })),
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      summary: e.summary,
      at: e.createdAt,
      by: e.by?.name ?? (e.byId ? "Someone" : "Bug Guard"),
    })),
    checks: AREAS.map((area) => ({
      area,
      list: ALL_CHECKS.filter((c) => c.area === area).map((c) => ({
        key: c.key,
        label: c.label,
        platform: Boolean(c.platform),
      })),
    })),
  };
}

export type BugGuardScreen = Awaited<ReturnType<typeof getBugGuard>>;

/** "Run now" on the screen: the report comes in the inbox and on the bot. */
export async function runNow(ctx: CompanyContext) {
  assertPlatform(ctx);
  const run = await startBugGuard(ctx.company.id, "NOW", ctx.user.id);
  return { id: run.id };
}
