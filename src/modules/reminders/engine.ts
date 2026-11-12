import { Prisma } from "@prisma/client";

import { addDays, dateColumn, daysBetween, localDay, localTime } from "@/lib/dates";
import { formatInstantDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  activeMembers,
  inAppRecipients,
  type Member,
  membersWith,
  staffLogins,
} from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";
import { nextOccurrence, parseRepeat } from "@/modules/reminders/repeat";
import {
  AUTO_TYPES,
  complianceSteps,
  dueStep,
  FOLLOW_UP_LIMITS,
  isFollowUpType,
  loadRules,
  RULE_INFO,
  type AutoType,
  type RuleSettings,
} from "@/modules/reminders/rules";
import { dueItems, reminderText } from "@/modules/reminders/sources";

/*
 * Sends the reminders that are due. Runs every minute from the scheduler (and
 * from tests with a chosen `now`):
 *   1. Reminders set by hand whose time has come go to their people's inboxes;
 *      repeating ones move on to their next time (once, even after a long gap).
 *   2. For each kind of watched date (rules.ts), every open record whose next
 *      step is due (a week before, on the day, every few days overdue...) gets
 *      one reminder, from the rule's send time on. Its sourceKey (kind, record,
 *      date, step) is unique, so a step never fires twice, not even when two
 *      servers run at once; a moved date starts its steps afresh.
 * Only in-app messages go out to staff. Follow-ups with buyers (a quotation
 * ending, an invoice due, a promised payment, a "Follow up on" date) also go,
 * as one message per run, to the owner's bot when one is linked (an alarm:
 * whether the AI is on or off). None of it ever goes to a buyer.
 */

type CompanyRow = { id: string; timezone: string };

export type ReminderRunResult = { manual: number; automatic: number; messages: number };

/** Runs both kinds of reminders for every active company (or one). */
export async function runReminders(
  now: Date = new Date(),
  options: { companyId?: string } = {},
): Promise<ReminderRunResult> {
  const companies = await prisma.company.findMany({
    where: { isActive: true, ...(options.companyId ? { id: options.companyId } : {}) },
    select: { id: true, timezone: true },
    orderBy: { createdAt: "asc" },
  });
  const total: ReminderRunResult = { manual: 0, automatic: 0, messages: 0 };
  for (const company of companies) {
    try {
      const members = await activeMembers(company.id);
      const manual = await fireManualReminders(company, members, now);
      const automatic = await fireAutomaticReminders(company, members, now);
      total.manual += manual.fired;
      total.automatic += automatic.fired;
      total.messages += manual.messages + automatic.messages;
    } catch (error) {
      // One company's problem must not stop the others' reminders.
      console.error(`[reminders] company ${company.id}`, error);
    }
  }
  return total;
}

const linkOf = (r: {
  projectId: string | null;
  orderId: string | null;
  purchaseOrderId: string | null;
  complianceDocumentId: string | null;
  taskId: string | null;
}) =>
  r.taskId
    ? { entityType: "Task", entityId: r.taskId }
    : r.projectId
      ? { entityType: "ProductionProject", entityId: r.projectId }
      : r.orderId
        ? { entityType: "SalesOrder", entityId: r.orderId }
        : r.purchaseOrderId
          ? { entityType: "PurchaseOrder", entityId: r.purchaseOrderId }
          : r.complianceDocumentId
            ? { entityType: "ComplianceDocument", entityId: r.complianceDocumentId }
            : { entityType: "Reminder", entityId: null };

async function fireManualReminders(company: CompanyRow, members: Member[], now: Date) {
  const due = await prisma.reminder.findMany({
    where: { companyId: company.id, status: "SCHEDULED", sourceKey: null, remindAt: { lte: now } },
    include: { recipients: { include: { employee: { select: { userId: true } } } } },
    orderBy: [{ remindAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  let fired = 0;
  let messages = 0;
  for (const reminder of due) {
    const repeat = parseRepeat(reminder.repeatRule);
    const next = repeat ? nextOccurrence(reminder.remindAt, repeat, company.timezone, now) : null;
    const recipients = inAppRecipients(
      members,
      reminder.recipients.flatMap((r) => (r.userId ? [r.userId] : [])),
      reminder.recipients.flatMap((r) =>
        r.employeeId ? [{ employeeId: r.employeeId, userId: r.employee?.userId ?? null }] : [],
      ),
    );
    const link = linkOf(reminder);
    const sent = await prisma.$transaction(async (tx) => {
      // Only the run that moves it on sends it (another server, or an edit, may have).
      const { count } = await tx.reminder.updateMany({
        where: { id: reminder.id, status: "SCHEDULED", remindAt: reminder.remindAt },
        data: next ? { remindAt: next, sentAt: now } : { status: "SENT", sentAt: now },
      });
      if (count === 0) return null;
      return sendInApp(
        tx,
        company.id,
        recipients,
        {
          subject: reminder.title,
          body:
            reminder.message ||
            `Reminder for ${formatInstantDay(reminder.remindAt, company.timezone)} ${localTime(reminder.remindAt, company.timezone)}.`,
          entityType: link.entityType,
          entityId: link.entityId ?? reminder.id,
          reminderId: reminder.id,
        },
        now,
      );
    });
    if (sent !== null) {
      fired += 1;
      messages += sent;
    }
  }
  return { fired, messages };
}

/** How far ahead a rule looks: its earliest step (licences: up to a year, their own window). */
const horizonDays = (rule: RuleSettings) =>
  rule.type === "COMPLIANCE_EXPIRY" ? 366 : Math.max(0, ...rule.daysBefore);

async function fireAutomaticReminders(company: CompanyRow, members: Member[], now: Date) {
  const today = localDay(now, company.timezone);
  const clock = localTime(now, company.timezone);
  const rules = await loadRules(company.id);
  let fired = 0;
  let messages = 0;
  /** Follow-ups with buyers fired in this run, for the owner's bot. */
  const followUps: string[] = [];

  for (const type of AUTO_TYPES) {
    const rule = rules[type];
    if (!rule.isActive || clock < rule.sendTime) continue;
    const items = await dueItems(
      company.id,
      type,
      addDays(today, horizonDays(rule)),
      company.timezone,
    );
    const followUp = isFollowUpType(type);
    // A quotation with no repeat set says "expired" once, the day after it ends.
    const every =
      type === "QUOTATION_EXPIRY" && rule.overdueEveryDays <= 0
        ? FOLLOW_UP_LIMITS.onceAfter
        : rule.overdueEveryDays;
    const period = every === FOLLOW_UP_LIMITS.onceAfter ? 1 : every;
    let steps = items.flatMap((item) => {
      const daysLeft = daysBetween(today, item.dueDay);
      // A follow-up snoozed from Home comes back on its new day, not days before it.
      const days = item.originalDay
        ? [0]
        : type === "COMPLIANCE_EXPIRY"
          ? complianceSteps(rule.daysBefore, item.alertDaysBefore ?? 30)
          : rule.daysBefore;
      const step = dueStep(daysLeft, days, followUp ? every : rule.overdueEveryDays);
      if (!step) return [];
      const late = step.offset < 0;
      // Follow-ups with buyers repeat a few times only, then wait for Done or payment.
      if (followUp && late && Number(step.key.slice(4)) >= FOLLOW_UP_LIMITS.repeats) return [];
      return [
        {
          item,
          daysLeft,
          step,
          sourceKey: `${type}:${item.recordId}:${item.dueDay}:${step.key}`,
          // Seen first long after its date: sent only if it was reminded before.
          stale: followUp && late && -daysLeft > FOLLOW_UP_LIMITS.stalePeriods * period,
        },
      ];
    });
    if (followUp) steps = await holdBackBacklog(company.id, type, steps, now);
    if (steps.length === 0) continue;

    const done = new Set(
      (
        await prisma.reminder.findMany({
          where: { companyId: company.id, sourceKey: { in: steps.map((s) => s.sourceKey) } },
          select: { sourceKey: true },
        })
      ).map((r) => r.sourceKey),
    );
    const pending = steps.filter((s) => !done.has(s.sourceKey));
    if (pending.length === 0) continue;

    const managers = rule.notifyManagers ? membersWith(members, RULE_INFO[type].managers) : [];
    const staffIds = [
      ...new Set([
        ...rule.employeeIds,
        ...(rule.notifyOwner ? pending.flatMap((s) => s.item.ownerEmployeeIds) : []),
      ]),
    ];
    const staff = await staffLogins(company.id, staffIds);

    for (const { item, daysLeft, step, sourceKey } of pending) {
      const ownerStaff = rule.notifyOwner ? item.ownerEmployeeIds : [];
      const employeeIds = [...new Set([...rule.employeeIds, ...ownerStaff])].filter((id) =>
        staff.has(id),
      );
      const userIds = [
        ...new Set([...managers, ...rule.userIds, ...(rule.notifyOwner ? item.ownerUserIds : [])]),
      ];
      const recipients = inAppRecipients(
        members,
        userIds,
        employeeIds.map((employeeId) => ({ employeeId, userId: staff.get(employeeId)!.userId })),
      );
      // The text tells the record's own date (a snoozed one's too), not the snoozed day.
      const text = reminderText(
        item,
        item.originalDay ? daysBetween(today, item.originalDay) : daysLeft,
      );
      try {
        const sent = await prisma.$transaction(async (tx) => {
          const reminder = await tx.reminder.create({
            data: {
              companyId: company.id,
              type,
              title: text.subject,
              message: text.body,
              remindAt: now,
              offsetDays: step.offset,
              dueDate: dateColumn(item.dueDay),
              sourceKey,
              status: "SENT",
              sentAt: now,
              channels: ["IN_APP"],
              ...item.refs,
              recipients: {
                create: [
                  ...userIds
                    .filter((id) => members.some((m) => m.userId === id))
                    .map((userId) => ({ userId })),
                  ...employeeIds.map((employeeId) => ({ employeeId })),
                ],
              },
            },
            select: { id: true },
          });
          return sendInApp(
            tx,
            company.id,
            recipients,
            {
              ...text,
              entityType: item.link.type,
              entityId: item.link.id,
              reminderId: reminder.id,
            },
            now,
          );
        });
        fired += 1;
        messages += sent;
        if (isFollowUpType(type)) followUps.push(`${text.subject}. ${text.body}`);
      } catch (error) {
        // Another run sent this step at the same moment.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }
        throw error;
      }
    }
  }
  if (followUps.length > 0) await tellOwnersBot(company.id, followUps);
  return { fired, messages };
}

type Step = {
  item: { recordId: string; dueDay: string };
  step: { key: string; offset: number };
  sourceKey: string;
  stale: boolean;
};

/**
 * Keeps a follow-up kind from flooding the inbox with old dates:
 *   - its first run marks the dates already overdue as reminded (CANCELLED,
 *     no one told) and leaves a start mark, so only what comes due from now on
 *     is sent;
 *   - later, a date first seen long after it passed (an old invoice entered
 *     today) is left out unless it was reminded about before.
 */
async function holdBackBacklog<T extends Step>(
  companyId: string,
  type: AutoType,
  steps: T[],
  now: Date,
): Promise<T[]> {
  const startKey = `${type}:started`;
  const started = await prisma.reminder.findUnique({
    where: { companyId_sourceKey: { companyId, sourceKey: startKey } },
    select: { id: true },
  });
  const quiet = (title: string, sourceKey: string, dueDay?: string, offset?: number) => ({
    companyId,
    type,
    title,
    message: "Not sent: it was already overdue when follow-up reminders began.",
    remindAt: now,
    sourceKey,
    status: "CANCELLED" as const,
    channels: [],
    ...(dueDay ? { dueDate: dateColumn(dueDay), offsetDays: offset } : {}),
  });
  if (!started) {
    const backlog = steps.filter((s) => s.step.offset < 0);
    await prisma.reminder.createMany({
      data: [
        quiet("Follow-up reminders started", startKey),
        ...backlog.map((s) =>
          quiet("Already overdue when follow-ups began", s.sourceKey, s.item.dueDay, s.step.offset),
        ),
      ],
      skipDuplicates: true,
    });
    return steps.filter((s) => s.step.offset >= 0);
  }
  const stale = steps.filter((s) => s.stale);
  if (stale.length === 0) return steps;
  const before = await prisma.reminder.findMany({
    where: {
      companyId,
      OR: stale.map((s) => ({
        sourceKey: { startsWith: `${type}:${s.item.recordId}:${s.item.dueDay}:` },
      })),
    },
    select: { sourceKey: true },
  });
  const seen = new Set(before.map((r) => r.sourceKey!.split(":").slice(0, 3).join(":")));
  return steps.filter((s) => !s.stale || seen.has(`${type}:${s.item.recordId}:${s.item.dueDay}`));
}

/** The follow-ups that fired, as one message on the owner's bot (never to anyone outside). */
async function tellOwnersBot(companyId: string, lines: string[]) {
  try {
    const { pushToBot } = await import("@/modules/ai/bot/push");
    const shown = lines.slice(0, 10);
    const more = lines.length - shown.length;
    const text = [
      `Follow-ups for today (${lines.length}):`,
      ...shown.map((line) => `• ${line}`),
      ...(more > 0 ? [`…and ${more} more in the ERP inbox.`] : []),
    ].join("\n");
    await pushToBot(companyId, { kind: "text", text: text.slice(0, 3500) }, { alarm: true });
  } catch (error) {
    console.error(
      "[reminders] follow-ups not sent to the bot",
      error instanceof Error ? error.message : error,
    );
  }
}
