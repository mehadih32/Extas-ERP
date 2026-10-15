import { Prisma } from "@prisma/client";

import { groupAmount } from "@/lib/display";
import { addDays, daysBetween, localDay, startOfDayInZone } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

import { pushToBot } from "./bot/push";
import { approvedRunSteps } from "./orders/order-run.service";
import { aiLabel, aiSettingsOf } from "./settings.service";

/*
 * Mehedi 2.0's two daily notes to the owner, written by the ERP from its own
 * data (no AI call, no cost), to the inbox and the linked bot while the AI is
 * on and each is switched on in AI Center > Settings:
 *   - the morning CEO brief at 08:00: the order steps due this week, what is
 *     late, what waits for the owner, and yesterday's AI cost;
 *   - the evening report at 19:00: what was done today, the plans waiting for
 *     Approve or Return, T&A slips, what staff told the AI, today's AI cost.
 * AI Home shows the morning brief at any time.
 */

const MORNING = 8;
const EVENING = 19;

type Company = { id: string; timezone: string; currency: string };

const money = (value: Prisma.Decimal, currency: string) =>
  `${currency} ${groupAmount(value.toFixed(2), currency)}`;

async function dayCost(companyId: string, day: string, timezone: string) {
  const sum = await prisma.aiUsage.aggregate({
    where: {
      companyId,
      createdAt: {
        gte: startOfDayInZone(day, timezone),
        lt: startOfDayInZone(addDays(day, 1), timezone),
      },
    },
    _sum: { cost: true },
    _count: true,
  });
  return { cost: sum._sum.cost ?? new Prisma.Decimal(0), calls: sum._count };
}

async function waitingForOwner(companyId: string) {
  const [permissions, deletions, drafts, plans, rules] = await Promise.all([
    prisma.aiPermissionRequest.count({ where: { companyId, status: "PENDING" } }),
    prisma.aiDeletionRequest.count({ where: { companyId, status: "PENDING" } }),
    prisma.aiDraft.count({ where: { companyId, status: "DRAFT" } }),
    prisma.aiOrderRun.findMany({
      where: { companyId, status: "WAITING_OWNER" },
      select: { number: true, title: true },
    }),
    prisma.houseRule.count({ where: { companyId, status: "PROPOSED" } }),
  ]);
  return { permissions, deletions, drafts, plans, rules };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The morning CEO brief, as lines (AI Home shows it; the clock sends it at 08:00). */
export async function morningBrief(company: Company, now: Date = new Date()) {
  const today = localDay(now, company.timezone);
  const [settings, orders, waiting, yesterday] = await Promise.all([
    aiSettingsOf(company.id),
    approvedRunSteps(company.id, company.timezone, now),
    waitingForOwner(company.id),
    dayCost(company.id, addDays(today, -1), company.timezone),
  ]);
  const due: string[] = [];
  const late: string[] = [];
  for (const order of orders) {
    for (const step of order.steps) {
      if (step.state === "late") late.push(`${order.number} ${step.label} (due ${step.by})`);
      else if (step.state === "waiting" && step.by && daysBetween(today, step.by) <= 7) {
        due.push(`${order.number} ${step.label} by ${step.by}`);
      }
    }
  }
  const asks = [
    waiting.plans.length ? plural(waiting.plans.length, "plan") + " to approve" : null,
    waiting.permissions ? plural(waiting.permissions, "permission request") : null,
    waiting.deletions ? plural(waiting.deletions, "Deletion request") : null,
    waiting.drafts ? plural(waiting.drafts, "draft") + " to send" : null,
    waiting.rules ? plural(waiting.rules, "House Rule") + " to approve" : null,
  ].filter(Boolean);
  return {
    title: `${aiLabel(settings)}: morning brief, ${today}`,
    lines: [
      orders.length
        ? `Orders I follow: ${orders.length}. Due this week: ${due.length ? due.join("; ") : "nothing"}.`
        : "No approved orders to follow yet.",
      late.length ? `Late: ${late.join("; ")}.` : "Nothing is late.",
      asks.length ? `Waiting for you: ${asks.join(", ")}.` : "Nothing waits for you.",
      `Yesterday's AI cost: ${money(yesterday.cost, company.currency)} (${plural(yesterday.calls, "call")}).`,
    ],
  };
}

/** The evening report, as lines (sent at 19:00). */
export async function eveningReport(company: Company, now: Date = new Date()) {
  const today = localDay(now, company.timezone);
  const from = startOfDayInZone(today, company.timezone);
  const [settings, orders, waiting, cost, actions, sent, updates] = await Promise.all([
    aiSettingsOf(company.id),
    approvedRunSteps(company.id, company.timezone, now),
    waitingForOwner(company.id),
    dayCost(company.id, today, company.timezone),
    prisma.auditLog.count({
      where: { companyId: company.id, byAi: true, createdAt: { gte: from } },
    }),
    prisma.aiDraft.count({
      where: { companyId: company.id, status: "SENT", sentAt: { gte: from } },
    }),
    prisma.aiStaffUpdate.findMany({
      where: { companyId: company.id, createdAt: { gte: from } },
      orderBy: [{ problem: "desc" }, { createdAt: "asc" }],
      take: 8,
      include: { user: { select: { name: true } }, run: { select: { number: true } } },
    }),
  ]);
  const slips = orders.flatMap((o) =>
    o.steps.filter((s) => s.state === "late").map((s) => `${o.number} ${s.label} (due ${s.by})`),
  );
  return {
    title: `${aiLabel(settings)}: report for ${today}`,
    lines: [
      `Done today: ${plural(actions, "thing")} by the AI, ${plural(sent, "draft")} sent by you.`,
      waiting.plans.length
        ? `Approve or Return: ${waiting.plans.map((p) => `${p.number} ${p.title}`).join("; ")}.`
        : "No plan waits for Approve.",
      slips.length ? `T&A slips: ${slips.join("; ")}.` : "No T&A slips.",
      updates.length
        ? `Staff told me: ${updates
            .map(
              (u) =>
                `${u.problem ? "PROBLEM " : ""}${u.user?.name ?? "Someone"}${u.run ? ` (${u.run.number})` : ""}: ${u.text.slice(0, 120)}`,
            )
            .join("; ")}.`
        : "No staff updates today.",
      `Today's AI cost: ${money(cost.cost, company.currency)} (${plural(cost.calls, "call")}).`,
    ],
  };
}

function hourIn(now: Date, timezone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .find((p) => p.type === "hour")!.value,
  );
}

/** With the reminder clock: each brief once a day after its hour, while the AI is on. */
export async function runBriefs(now: Date = new Date(), options: { companyId?: string } = {}) {
  const companies = await prisma.company.findMany({
    where: { isActive: true, ...(options.companyId ? { id: options.companyId } : {}) },
    select: { id: true, timezone: true, currency: true },
  });
  let sent = 0;
  for (const company of companies) {
    try {
      const settings = await aiSettingsOf(company.id);
      if (!settings.enabled || settings.pausedAt || !settings.id) continue;
      const today = localDay(now, company.timezone);
      const hour = hourIn(now, company.timezone);
      const due: Array<"brief" | "report"> = [];
      if (settings.morningBrief && hour >= MORNING && settings.briefSentOn !== today)
        due.push("brief");
      if (settings.eveningReport && hour >= EVENING && settings.reportSentOn !== today)
        due.push("report");
      for (const kind of due) {
        const claimed = await prisma.aiSettings.updateMany({
          where:
            kind === "brief"
              ? {
                  companyId: company.id,
                  OR: [{ briefSentOn: null }, { briefSentOn: { not: today } }],
                }
              : {
                  companyId: company.id,
                  OR: [{ reportSentOn: null }, { reportSentOn: { not: today } }],
                },
          data: kind === "brief" ? { briefSentOn: today } : { reportSentOn: today },
        });
        if (claimed.count === 0) continue;
        const note =
          kind === "brief" ? await morningBrief(company, now) : await eveningReport(company, now);
        const owners = membersWith(await activeMembers(company.id), ["ai.manage"]).map(
          (userId) => ({
            userId,
          }),
        );
        await sendInApp(
          prisma,
          company.id,
          owners,
          {
            subject: note.title,
            body: note.lines.join("\n"),
            entityType: "AiRequest",
            entityId: company.id,
          },
          now,
        );
        await pushToBot(company.id, { kind: "text", text: [note.title, ...note.lines].join("\n") });
        sent += 1;
      }
    } catch (error) {
      console.error(`[briefs] company ${company.id}`, error);
    }
  }
  return sent;
}
