import { dateColumn, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

import { pushToBot } from "./bot/push";
import { askerFor } from "./claude";
import { makeAiDraft } from "./drafts.service";
import { aiLabel, aiSettingsOf } from "./settings.service";

/*
 * Mehedi 2.0's reminders to the owner, run with the reminder clock every
 * minute (reminders/scheduler.ts):
 *   1. A follow-up date has come: a draft for the buyer is made (by the AI
 *      when it is on, else the plain one) and the owner is told.
 *   2. A buyer's draft is still not sent after the owner's time: the owner is
 *      reminded once.
 * Both also go to the owner's bot when one is linked (AI Center > Bot).
 * Nothing is sent to anyone outside the company: the owner sends the drafts.
 * The owners are the people who answer the AI (ai.manage). While the AI is
 * switched off or paused, none of it runs: no drafts, no reminders, nothing
 * on the bot (a follow-up date waits until the AI is on again).
 */

export type AiReminderRun = { followUps: number; waiting: number };

export async function runAiReminders(
  now: Date = new Date(),
  options: { companyId?: string } = {},
): Promise<AiReminderRun> {
  const companies = await prisma.company.findMany({
    where: { isActive: true, ...(options.companyId ? { id: options.companyId } : {}) },
    select: { id: true, timezone: true },
    orderBy: { createdAt: "asc" },
  });
  const total: AiReminderRun = { followUps: 0, waiting: 0 };
  for (const company of companies) {
    try {
      const run = await remindCompany(company, now);
      total.followUps += run.followUps;
      total.waiting += run.waiting;
    } catch (error) {
      console.error(`[ai-reminders] company ${company.id}`, error);
    }
  }
  return total;
}

async function remindCompany(company: { id: string; timezone: string }, now: Date) {
  const settings = await aiSettingsOf(company.id);
  if (!settings.enabled || settings.pausedAt) return { followUps: 0, waiting: 0 };
  const today = localDay(now, company.timezone);
  const [due, waiting] = await Promise.all([
    prisma.aiFollowUp.findMany({
      where: {
        companyId: company.id,
        status: "OPEN",
        remindedAt: null,
        dueOn: { lte: dateColumn(today) },
      },
      include: { party: { select: { id: true, name: true } } },
      orderBy: { dueOn: "asc" },
      take: 20,
    }),
    prisma.aiDraft.findMany({
      where: { companyId: company.id, status: "DRAFT", remindedAt: null, remindAt: { lte: now } },
      include: { party: { select: { name: true } } },
      orderBy: { remindAt: "asc" },
      take: 50,
    }),
  ]);
  if (due.length === 0 && waiting.length === 0) return { followUps: 0, waiting: 0 };

  const owners = membersWith(await activeMembers(company.id), ["ai.manage"]).map((userId) => ({
    userId,
  }));
  const name = aiLabel(settings);
  // The AI words the drafts only while it is on (not paused, with a key).
  const ask = await askerFor(company.id);

  let followUps = 0;
  for (const f of due) {
    // Claimed first, so two servers never make two drafts for one date.
    const claimed = await prisma.aiFollowUp.updateMany({
      where: { id: f.id, remindedAt: null, status: "OPEN" },
      data: { remindedAt: now },
    });
    if (claimed.count === 0) continue;
    const draft = await makeAiDraft(
      company.id,
      {
        kind: "BUYER_FOLLOW_UP",
        partyId: f.partyId,
        about: f.recordLabel ?? f.note ?? "our order",
        points: f.note,
        record: f.recordLabel ? { type: "AiFollowUp", id: f.id, label: f.recordLabel } : undefined,
      },
      { ask, followUpId: f.id },
    );
    await prisma.aiFollowUp.update({ where: { id: f.id }, data: { draftId: draft.id } });
    await sendInApp(
      prisma,
      company.id,
      owners,
      {
        subject: `Follow up with ${f.party.name} today`,
        body: `${f.recordLabel ? `${f.recordLabel}: ` : ""}${name} drafted a follow-up for you. Check it and press Send in AI Center > Drafts.`,
        entityType: "AiDraft",
        entityId: draft.id,
      },
      now,
    );
    // On the bot too, with Send and Discard under it.
    await pushToBot(company.id, {
      kind: "draft",
      draftId: draft.id,
      text: `Follow up with ${f.party.name} today: ${name} drafted it for you.`,
    });
    followUps += 1;
  }

  let reminded = 0;
  for (const d of waiting) {
    const claimed = await prisma.aiDraft.updateMany({
      where: { id: d.id, status: "DRAFT", remindedAt: null },
      data: { remindedAt: now },
    });
    if (claimed.count === 0) continue;
    await sendInApp(
      prisma,
      company.id,
      owners,
      {
        subject: `Not sent yet: ${d.subject}`,
        body: `The draft${d.party ? ` for ${d.party.name}` : ""} is waiting for you. Nothing goes to a buyer until you press Send in AI Center > Drafts.`,
        entityType: "AiDraft",
        entityId: d.id,
      },
      now,
    );
    await pushToBot(company.id, {
      kind: "draft",
      draftId: d.id,
      text: `Not sent yet: the draft${d.party ? ` for ${d.party.name}` : ""} is waiting for you.`,
    });
    reminded += 1;
  }
  return { followUps, waiting: reminded };
}
