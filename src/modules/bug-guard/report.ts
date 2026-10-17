import { prisma } from "@/lib/prisma";
import { pushToBot } from "@/modules/ai/bot/push";
import { sendInApp } from "@/modules/reminders/notification.service";

import { runNowButton, type SummaryInput, summaryText, weekText } from "./bot-texts";
import { ownersOf } from "./owner";
import type { CheckResult, Severity } from "./types";

/*
 * Bug Guard's reports, on the bot (the owner's own alarm: sent whether the AI
 * is on or off) and in the ERP inbox of the platform owners: after each run a
 * summary grouped Urgent / Important / Can wait, then each new urgent or
 * important problem on its own with Fix, Ignore and Remind me later; a weekly
 * summary even when all is well.
 */

/** Problems sent one by one after a run, at most. */
export const ITEMS_PER_REPORT = 8;

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const ORDER: Record<Severity, number> = { URGENT: 0, IMPORTANT: 1, LATER: 2 };

async function tell(companyId: string, subject: string, body: string, entityId: string) {
  const owners = await ownersOf(companyId);
  if (owners.length) {
    await sendInApp(
      prisma,
      companyId,
      owners.map((o) => ({ userId: o.id })),
      { subject, body, entityType: "BugGuardRun", entityId },
    );
  }
  await pushToBot(
    companyId,
    { kind: "text", text: body, buttons: [[runNowButton(companyId)]] },
    { alarm: true },
  );
}

async function sendItems(companyId: string, ids: string[]) {
  if (ids.length === 0) return;
  const items = await prisma.bugGuardFinding.findMany({
    where: {
      companyId,
      id: { in: ids },
      status: "OPEN",
      severity: { in: ["URGENT", "IMPORTANT"] },
    },
    select: { id: true, severity: true },
  });
  items.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  for (const item of items.slice(0, ITEMS_PER_REPORT)) {
    await pushToBot(companyId, { kind: "guard", findingId: item.id }, { alarm: true });
  }
  await prisma.bugGuardFinding.updateMany({
    where: { companyId, id: { in: ids } },
    data: { reportedAt: new Date() },
  });
}

/** After a run: the summary, then the new urgent and important problems one by one. */
export async function reportRun(runId: string, freshIds: string[]) {
  const run = await prisma.bugGuardRun.findUniqueOrThrow({
    where: { id: runId },
    include: { company: { select: { name: true } } },
  });
  const open = await prisma.bugGuardFinding.findMany({
    where: { companyId: run.companyId, status: "OPEN" },
    select: { severity: true, title: true, href: true },
    orderBy: [{ lastSeenAt: "desc" }],
    take: 200,
  });
  open.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const checks = (run.checks as unknown as CheckResult[]) ?? [];
  const input: SummaryInput = {
    company: run.company.name,
    at: run.finishedAt ?? run.startedAt,
    checked: checks.length,
    failedChecks: checks.filter((c) => c.status === "FAILED").map((c) => c.label),
    newCount: run.newCount,
    fixedCount: run.fixedCount,
    open,
    note: run.fullCheckRunId
      ? "সব স্ক্রিন, পিডিএফ ও লেআউটের Full check GitHub-এ চলছে; শেষ হলে নতুন কিছু পেলে আলাদা করে জানাব।"
      : null,
  };
  const body = summaryText(input, appUrl());
  const subject =
    run.urgent + run.important === 0
      ? "Bug Guard: সব ঠিক আছে"
      : `Bug Guard: জরুরি ${run.urgent}, গুরুত্বপূর্ণ ${run.important}`;
  await tell(run.companyId, subject, body, run.id);
  await sendItems(run.companyId, freshIds);
  await prisma.bugGuardRun.update({ where: { id: run.id }, data: { reportSentAt: new Date() } });
  await prisma.bugGuardEvent.create({
    data: { companyId: run.companyId, runId, kind: "REPORT", summary: subject },
  });
}

/** When the Full check a run asked for reports back: only if it found or cleared something. */
export async function reportFullCheck(runId: string, freshIds: string[], cleared: number) {
  if (freshIds.length === 0 && cleared === 0) return;
  const run = await prisma.bugGuardRun.findUniqueOrThrow({
    where: { id: runId },
    select: { id: true, companyId: true },
  });
  const fresh = await prisma.bugGuardFinding.findMany({
    where: { id: { in: freshIds } },
    select: { severity: true, title: true },
  });
  fresh.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const body = [
    "Bug Guard · Full check শেষ (সব স্ক্রিন, পিডিএফ ও লেআউট)",
    `নতুন সমস্যা ${fresh.length}টি, ঠিক হয়ে গেছে ${cleared}টি।`,
    ...fresh.slice(0, 10).map((f) => `• ${f.title}`),
    `${appUrl()}/ai/bug-guard`,
  ].join("\n");
  await tell(run.companyId, `Bug Guard: Full check, ${fresh.length} new`, body, run.id);
  await sendItems(run.companyId, freshIds);
}

/** The weekly summary, even when all is well. */
export async function sendWeekly(companyId: string, now: Date) {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const [company, runs, found, fixed, corrections, securitySteps, open] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
    prisma.bugGuardRun.count({ where: { companyId, status: "DONE", startedAt: { gte: from } } }),
    prisma.bugGuardEvent.count({
      where: { companyId, kind: { in: ["FOUND", "REOPENED"] }, createdAt: { gte: from } },
    }),
    prisma.bugGuardEvent.count({
      where: { companyId, kind: { in: ["FIXED", "GONE"] }, createdAt: { gte: from } },
    }),
    prisma.bugGuardEvent.count({ where: { companyId, kind: "APPLIED", createdAt: { gte: from } } }),
    prisma.bugGuardEvent.count({
      where: {
        companyId,
        kind: { in: ["SESSION_ENDED", "SOURCE_BLOCKED", "SOURCE_UNBLOCKED"] },
        createdAt: { gte: from },
      },
    }),
    import("./runner").then((m) => m.openCounts(companyId)),
  ]);
  const body = weekText(
    { company: company.name, from, to: now, runs, found, fixed, corrections, securitySteps, open },
    appUrl(),
  );
  await tell(companyId, "Bug Guard: weekly summary", body, companyId);
  await prisma.bugGuardEvent.create({
    data: { companyId, kind: "REPORT", summary: "Weekly summary sent" },
  });
}
