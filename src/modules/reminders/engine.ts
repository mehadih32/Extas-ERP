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
  loadRules,
  RULE_INFO,
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
 * Only in-app messages go out for now; WhatsApp and email come with the
 * integrations stage.
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

  for (const type of AUTO_TYPES) {
    const rule = rules[type];
    if (!rule.isActive || clock < rule.sendTime) continue;
    const items = await dueItems(
      company.id,
      type,
      addDays(today, horizonDays(rule)),
      company.timezone,
    );
    const steps = items.flatMap((item) => {
      const daysLeft = daysBetween(today, item.dueDay);
      const days =
        type === "COMPLIANCE_EXPIRY"
          ? complianceSteps(rule.daysBefore, item.alertDaysBefore ?? 30)
          : rule.daysBefore;
      const step = dueStep(daysLeft, days, rule.overdueEveryDays);
      return step
        ? [
            {
              item,
              daysLeft,
              step,
              sourceKey: `${type}:${item.recordId}:${item.dueDay}:${step.key}`,
            },
          ]
        : [];
    });
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
      const text = reminderText(item, daysLeft);
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
      } catch (error) {
        // Another run sent this step at the same moment.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }
        throw error;
      }
    }
  }
  return { fired, messages };
}
