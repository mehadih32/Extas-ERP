import type { Prisma } from "@prisma/client";

import {
  addDays,
  atLocalTime,
  daysBetween,
  localDay,
  localTime,
  nextDay,
  startOfDayInZone,
} from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatInstantDay } from "@/lib/format";
import { assertAllowed } from "@/lib/verdict";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { linkedEmployee } from "@/modules/hr/access";
import {
  canAcknowledgeReminder,
  canCancelReminder,
  canDeleteReminder,
  canEditReminder,
  type ReminderState,
} from "@/modules/reminders/checks";
import { describeRepeat, formatRepeat, parseRepeat, type Repeat } from "@/modules/reminders/repeat";
import { AUTO_TYPES, type AutoType } from "@/modules/reminders/rules";
import {
  createReminderSchema,
  listRemindersSchema,
  updateReminderSchema,
  upcomingSchema,
} from "@/modules/reminders/schemas";
import { dueItems } from "@/modules/reminders/sources";

/*
 * Reminders set by hand ("call Rahim Traders about the advance on Monday 10:00",
 * "file the VAT return on the 15th of every month") and the ones the rules made
 * (engine.ts). Anyone with the notepad can set reminders for themselves; telling
 * other people needs reminders.manage. You see the reminders you set or are on;
 * reminders.manage also sees everyone's with `all`. In-app only for now.
 */

const reminderInclude = {
  createdBy: { select: { id: true, name: true } },
  acknowledgedBy: { select: { id: true, name: true } },
  recipients: {
    include: {
      user: { select: { id: true, name: true } },
      employee: { select: { id: true, name: true, userId: true } },
    },
  },
  project: { select: { id: true, code: true, name: true } },
  order: { select: { id: true, number: true } },
  purchaseOrder: { select: { id: true, number: true } },
  complianceDocument: { select: { id: true, title: true, number: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.ReminderInclude;

type ReminderRow = Prisma.ReminderGetPayload<{ include: typeof reminderInclude }>;

function present(r: ReminderRow, timeZone: string) {
  const repeat = parseRepeat(r.repeatRule);
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    message: r.message,
    status: r.status,
    /** Made by a rule when a date came near (not set by hand). */
    automatic: r.sourceKey !== null,
    /** When it goes out next (or went out), and that day and time in company time. */
    remindAt: r.remindAt,
    day: localDay(r.remindAt, timeZone),
    time: localTime(r.remindAt, timeZone),
    repeat: repeat
      ? {
          every: repeat.every,
          interval: repeat.interval,
          until: repeat.until,
          description: describeRepeat(repeat),
        }
      : null,
    /** Automatic ones: the date they are about, and how many days before it (negative = after). */
    dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
    offsetDays: r.offsetDays,
    sentAt: r.sentAt,
    acknowledgedAt: r.acknowledgedAt,
    acknowledgedBy: r.acknowledgedBy,
    createdBy: r.createdBy,
    recipients: r.recipients.map((x) =>
      x.employee
        ? {
            kind: "employee" as const,
            id: x.employee.id,
            name: x.employee.name,
            /** In-app messages reach staff through their login; without one they wait for WhatsApp. */
            inApp: x.employee.userId !== null,
          }
        : {
            kind: "user" as const,
            id: x.user?.id ?? null,
            name: x.user?.name ?? null,
            inApp: true,
          },
    ),
    links: {
      project: r.project,
      order: r.order,
      purchaseOrder: r.purchaseOrder,
      complianceDocument: r.complianceDocument,
      task: r.task,
    },
    createdAt: r.createdAt,
  };
}

export type ReminderView = ReturnType<typeof present>;

/** The reminders a person may see without `all`: theirs, or ones they are on (directly or as staff). */
function visibleWhere(ctx: CompanyContext): Prisma.ReminderWhereInput {
  return {
    OR: [
      { createdById: ctx.user.id },
      { recipients: { some: { userId: ctx.user.id } } },
      { recipients: { some: { employee: { userId: ctx.user.id } } } },
    ],
  };
}

async function loadVisible(ctx: CompanyContext, reminderId: string): Promise<ReminderRow> {
  const row = await ctx.db.reminder.findFirst({
    where: {
      id: reminderId,
      ...(ctx.can("reminders.manage") ? {} : visibleWhere(ctx)),
    },
    include: reminderInclude,
  });
  if (!row) throw new AppError("NOT_FOUND", "Reminder not found.");
  return row;
}

/** Where a reminder stands, for the rules in checks.ts. */
export function reminderState(r: {
  sourceKey: string | null;
  createdById: string | null;
  status: ReminderState["status"];
  repeatRule: string | null;
  sentAt: Date | null;
  acknowledgedAt: Date | null;
}): ReminderState {
  return {
    automatic: r.sourceKey !== null,
    createdById: r.createdById,
    status: r.status,
    repeating: r.repeatRule !== null,
    sentAt: r.sentAt,
    acknowledgedAt: r.acknowledgedAt,
  };
}

const acting = (ctx: CompanyContext) => ({
  userId: ctx.user.id,
  manage: ctx.can("reminders.manage"),
});

async function checkPeople(
  ctx: CompanyContext,
  userIds: string[] | undefined,
  employeeIds: string[] | undefined,
) {
  const users = userIds?.length ? userIds : employeeIds?.length ? [] : [ctx.user.id];
  const staff = employeeIds ?? [];
  const others = users.some((id) => id !== ctx.user.id) || staff.length > 0;
  if (others && !ctx.can("reminders.manage")) {
    throw new AppError(
      "FORBIDDEN",
      "You can set reminders for yourself. Reminders for other people need the reminders permission.",
    );
  }
  if (users.length > 0) {
    const found = await prisma.companyMembership.count({
      where: {
        companyId: ctx.company.id,
        userId: { in: users },
        isActive: true,
        user: { status: { not: "SUSPENDED" } },
      },
    });
    // A platform owner without a membership can still remind themselves.
    const selfOnly = users.length === 1 && users[0] === ctx.user.id;
    if (found !== users.length && !selfOnly) {
      throw new AppError(
        "VALIDATION",
        "Some of these people are not active users of this company.",
        {
          userIds: ["Pick active users of this company"],
        },
      );
    }
  }
  if (staff.length > 0) {
    const found = await ctx.db.employee.count({
      where: { id: { in: staff }, status: { in: ["ACTIVE", "ON_LEAVE"] } },
    });
    if (found !== staff.length) {
      throw new AppError("VALIDATION", "Some of these employees were not found.", {
        employeeIds: ["Pick current employees of this company"],
      });
    }
  }
  return { users, staff };
}

type Links = {
  projectId?: string | null;
  orderId?: string | null;
  purchaseOrderId?: string | null;
  complianceDocumentId?: string | null;
  taskId?: string | null;
};

async function checkLinks(ctx: CompanyContext, links: Links) {
  const checks: Array<[string | null | undefined, () => Promise<unknown>, string]> = [
    [
      links.projectId,
      () => ctx.db.productionProject.findUnique({ where: { id: links.projectId! } }),
      "Production project",
    ],
    [
      links.orderId,
      () => ctx.db.salesOrder.findUnique({ where: { id: links.orderId! } }),
      "Sales order",
    ],
    [
      links.purchaseOrderId,
      () => ctx.db.purchaseOrder.findUnique({ where: { id: links.purchaseOrderId! } }),
      "Purchase order",
    ],
    [
      links.complianceDocumentId,
      () => ctx.db.complianceDocument.findUnique({ where: { id: links.complianceDocumentId! } }),
      "Licence record",
    ],
    [links.taskId, () => ctx.db.task.findUnique({ where: { id: links.taskId! } }), "Task"],
  ];
  for (const [value, find, label] of checks) {
    if (value && !(await find())) throw new AppError("NOT_FOUND", `${label} not found.`);
  }
}

function whenOf(
  ctx: CompanyContext,
  input: { remindAt?: string; day?: string; time?: string },
  fallbackTime: string,
): Date | null {
  if (input.remindAt) return new Date(input.remindAt);
  if (input.day) return atLocalTime(input.day, input.time ?? fallbackTime, ctx.company.timezone);
  return null;
}

function assertFuture(at: Date, now: Date) {
  if (at.getTime() < now.getTime() - 60_000) {
    throw new AppError("VALIDATION", "Pick a time that has not passed yet.", {
      remindAt: ["Must be in the future"],
    });
  }
}

function repeatOf(
  ctx: CompanyContext,
  input: { every: Repeat["every"]; interval: number; until?: string },
  first: Date,
): Repeat {
  const day = localDay(first, ctx.company.timezone);
  if (input.until && input.until < day) {
    throw new AppError("VALIDATION", "The last day is before the first reminder.", {
      "repeat.until": ["Must be on or after the first reminder"],
    });
  }
  return {
    every: input.every,
    interval: input.interval,
    until: input.until ?? null,
    monthDay: input.every === "MONTH" || input.every === "YEAR" ? Number(day.slice(8, 10)) : null,
  };
}

const linkData = (input: Links) => ({
  ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
  ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
  ...(input.purchaseOrderId !== undefined ? { purchaseOrderId: input.purchaseOrderId } : {}),
  ...(input.complianceDocumentId !== undefined
    ? { complianceDocumentId: input.complianceDocumentId }
    : {}),
  ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
});

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export async function createReminder(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const input = createReminderSchema.parse(raw);
  const { users, staff } = await checkPeople(ctx, input.userIds, input.employeeIds);
  await checkLinks(ctx, input);
  const remindAt = whenOf(ctx, input, "09:00")!;
  assertFuture(remindAt, now);
  const repeat = input.repeat ? repeatOf(ctx, input.repeat, remindAt) : null;

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.reminder.create({
      data: {
        companyId: ctx.company.id,
        type: input.type,
        title: input.title,
        message: input.message || null,
        remindAt,
        repeatRule: repeat ? formatRepeat(repeat) : null,
        status: "SCHEDULED",
        channels: ["IN_APP"],
        createdById: ctx.user.id,
        ...linkData(input),
        recipients: {
          create: [
            ...users.map((userId) => ({ userId })),
            ...staff.map((employeeId) => ({ employeeId })),
          ],
        },
      },
      include: reminderInclude,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Reminder",
        entityId: created.id,
        summary: `Reminder "${created.title}" for ${formatInstantDay(remindAt, ctx.company.timezone)} ${localTime(remindAt, ctx.company.timezone)}${repeat ? ` (${lowerFirst(describeRepeat(repeat))})` : ""}, to ${created.recipients.length} ${created.recipients.length === 1 ? "person" : "people"}`,
      },
      tx,
    );
    return created;
  });
  return present(row, ctx.company.timezone);
}

/** Changes a reminder set by hand that has not gone out yet. */
export async function updateReminder(
  ctx: CompanyContext,
  reminderId: string,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const input = updateReminderSchema.parse(raw);
  const row = await loadVisible(ctx, reminderId);
  assertAllowed(canEditReminder(reminderState(row), acting(ctx)));
  // Giving only users (or only staff) keeps the other list as it was.
  const peopleChanged = input.userIds !== undefined || input.employeeIds !== undefined;
  const people = peopleChanged
    ? await checkPeople(
        ctx,
        input.userIds ?? row.recipients.flatMap((r) => (r.userId ? [r.userId] : [])),
        input.employeeIds ?? row.recipients.flatMap((r) => (r.employeeId ? [r.employeeId] : [])),
      )
    : null;
  await checkLinks(ctx, input);
  const remindAt = whenOf(ctx, input, localTime(row.remindAt, ctx.company.timezone));
  if (remindAt) assertFuture(remindAt, now);
  const first = remindAt ?? row.remindAt;
  const repeatInput =
    input.repeat === undefined
      ? undefined
      : input.repeat === null
        ? null
        : repeatOf(ctx, input.repeat, first);
  // A moved monthly reminder keeps falling on its (new) day of the month.
  const kept = parseRepeat(row.repeatRule);
  const repeat =
    repeatInput === undefined
      ? kept && remindAt
        ? repeatOf(ctx, { ...kept, until: kept.until ?? undefined }, first)
        : kept
      : repeatInput;

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.reminder.updateMany({
      where: { id: row.id, companyId: ctx.company.id, status: "SCHEDULED", remindAt: row.remindAt },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.message !== undefined ? { message: input.message || null } : {}),
        ...(remindAt ? { remindAt } : {}),
        repeatRule: repeat ? formatRepeat(repeat) : null,
        ...linkData(input),
      },
    });
    if (count === 0) {
      throw new AppError("CONFLICT", "This reminder just went out. Refresh and try again.");
    }
    if (people) {
      await tx.reminderRecipient.deleteMany({ where: { reminderId: row.id } });
      await tx.reminderRecipient.createMany({
        data: [
          ...people.users.map((userId) => ({ reminderId: row.id, userId })),
          ...people.staff.map((employeeId) => ({ reminderId: row.id, employeeId })),
        ],
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Reminder",
        entityId: row.id,
        summary: `Edited reminder "${input.title ?? row.title}": ${Object.keys(input).join(", ")}`,
      },
      tx,
    );
    return tx.reminder.findUniqueOrThrow({ where: { id: row.id }, include: reminderInclude });
  });
  return present(updated, ctx.company.timezone);
}

export async function cancelReminder(ctx: CompanyContext, reminderId: string, meta?: RequestMeta) {
  const row = await loadVisible(ctx, reminderId);
  assertAllowed(canCancelReminder(reminderState(row), acting(ctx)));
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.reminder.updateMany({
      where: { id: row.id, companyId: ctx.company.id, status: "SCHEDULED" },
      data: { status: "CANCELLED" },
    });
    if (count === 0) throw new AppError("CONFLICT", "This reminder just went out.");
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Reminder",
        entityId: row.id,
        summary: `Cancelled reminder "${row.title}"`,
      },
      tx,
    );
    return tx.reminder.findUniqueOrThrow({ where: { id: row.id }, include: reminderInclude });
  });
  return present(updated, ctx.company.timezone);
}

export async function deleteReminder(ctx: CompanyContext, reminderId: string, meta?: RequestMeta) {
  const row = await loadVisible(ctx, reminderId);
  assertAllowed(canDeleteReminder(reminderState(row), acting(ctx)));
  await prisma.$transaction(async (tx) => {
    await tx.reminder.delete({ where: { id: row.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "Reminder",
        entityId: row.id,
        summary: `Deleted reminder "${row.title}"`,
      },
      tx,
    );
  });
  return { id: row.id, deleted: true };
}

/**
 * Marks a reminder that went out as dealt with (anyone it went to, or
 * reminders.manage); your messages about it are marked read too. A repeating
 * one stays scheduled for its next time: dealt with means this time
 * (acknowledgedAt after sentAt).
 */
export async function acknowledgeReminder(
  ctx: CompanyContext,
  reminderId: string,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const row = await loadVisible(ctx, reminderId);
  if (row.status === "ACKNOWLEDGED") return present(row, ctx.company.timezone);
  assertAllowed(canAcknowledgeReminder(reminderState(row)));
  const repeating = row.status === "SCHEDULED";
  const updated = await prisma.$transaction(async (tx) => {
    await tx.reminder.updateMany({
      where: { id: row.id, companyId: ctx.company.id, status: row.status },
      data: {
        ...(repeating ? {} : { status: "ACKNOWLEDGED" as const }),
        acknowledgedAt: now,
        acknowledgedById: ctx.user.id,
      },
    });
    await tx.notificationLog.updateMany({
      where: { companyId: ctx.company.id, reminderId: row.id, userId: ctx.user.id, readAt: null },
      data: { readAt: now, status: "READ" },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Reminder",
        entityId: row.id,
        summary: `Dealt with: ${row.title}`,
      },
      tx,
    );
    return tx.reminder.findUniqueOrThrow({ where: { id: row.id }, include: reminderInclude });
  });
  return present(updated, ctx.company.timezone);
}

/**
 * Marks the automatic alerts already sent about a record as dealt with, once the
 * record itself is (a licence renewed or archived, a task finished or cancelled).
 */
export async function settleAlerts(
  tx: Prisma.TransactionClient,
  companyId: string,
  link: { complianceDocumentId: string } | { taskId: string },
  userId: string,
  now: Date,
) {
  await tx.reminder.updateMany({
    where: { companyId, ...link, sourceKey: { not: null }, status: "SENT" },
    data: { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedById: userId },
  });
}

export async function getReminder(ctx: CompanyContext, reminderId: string) {
  return present(await loadVisible(ctx, reminderId), ctx.company.timezone);
}

/** Your reminders (or everyone's with `all` and reminders.manage), latest first. */
export async function listReminders(ctx: CompanyContext, raw: unknown = {}) {
  const input = listRemindersSchema.parse(raw);
  if (input.all && !ctx.can("reminders.manage")) {
    throw new AppError(
      "FORBIDDEN",
      "Only people with the reminders permission see everyone's reminders.",
    );
  }
  const where: Prisma.ReminderWhereInput = {
    AND: [
      input.all ? {} : visibleWhere(ctx),
      input.status ? { status: input.status } : {},
      input.type ? { type: input.type } : {},
      input.automatic === undefined
        ? {}
        : input.automatic
          ? { sourceKey: { not: null } }
          : { sourceKey: null },
      input.projectId ? { projectId: input.projectId } : {},
      input.orderId ? { orderId: input.orderId } : {},
      input.purchaseOrderId ? { purchaseOrderId: input.purchaseOrderId } : {},
      input.complianceDocumentId ? { complianceDocumentId: input.complianceDocumentId } : {},
      input.taskId ? { taskId: input.taskId } : {},
    ],
  };
  const rows = await ctx.db.reminder.findMany({
    where,
    include: reminderInclude,
    orderBy: [{ remindAt: "desc" }, { id: "desc" }],
    take: input.take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > input.take;
  const items = hasMore ? rows.slice(0, input.take) : rows;
  return {
    items: items.map((r) => present(r, ctx.company.timezone)),
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  };
}

// --- Coming up (the planner's agenda) ------------------------------------------------------

/** Who may see each kind of date in the agenda (tasks: see below). */
function canSee(ctx: CompanyContext, type: AutoType): boolean {
  switch (type) {
    case "PRODUCTION_DEADLINE":
      return ctx.can("production.view") || ctx.can("production.manage");
    case "GOODS_IN_HOUSE":
      return ctx.can("materials.view") || ctx.can("materials.purchase");
    case "SHIPMENT":
      return ctx.can("sales.view");
    case "COMPLIANCE_EXPIRY":
      return ctx.can("compliance.view") || ctx.can("compliance.manage");
    case "TASK_DUE":
      return true;
  }
}

type AgendaItem = {
  kind: AutoType | "REMINDER";
  date: string;
  time: string | null;
  daysLeft: number;
  overdue: boolean;
  title: string;
  detail: string | null;
  link: { type: string; id: string };
};

/**
 * Everything coming up for you in the next days, and what is overdue: deadlines,
 * goods due in-house, shipments, renewals (as far as your role lets you see
 * them), your tasks (every task with reminders.manage) and your own reminders.
 */
export async function upcoming(ctx: CompanyContext, raw: unknown = {}, now: Date = new Date()) {
  const { days } = upcomingSchema.parse(raw);
  const tz = ctx.company.timezone;
  const today = localDay(now, tz);
  const until = addDays(today, days - 1);

  const items: AgendaItem[] = [];
  const me = await linkedEmployee(ctx);
  for (const type of AUTO_TYPES) {
    if (!canSee(ctx, type)) continue;
    let found = await dueItems(ctx.company.id, type, until, tz, prisma, 200);
    if (type === "TASK_DUE" && !ctx.can("reminders.manage")) {
      found = found.filter(
        (t) =>
          t.ownerUserIds.includes(ctx.user.id) ||
          (me !== null && t.ownerEmployeeIds.includes(me.id)),
      );
    }
    for (const item of found) {
      const daysLeft = daysBetween(today, item.dueDay);
      items.push({
        kind: type,
        date: item.dueDay,
        time: item.dueTime,
        daysLeft,
        overdue: daysLeft < 0,
        title: item.title,
        detail: item.detail,
        link: item.link,
      });
    }
  }

  const reminders = await ctx.db.reminder.findMany({
    where: {
      AND: [
        visibleWhere(ctx),
        { status: "SCHEDULED", sourceKey: null },
        { remindAt: { lt: startOfDayInZone(nextDay(until), tz) } },
      ],
    },
    orderBy: [{ remindAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  for (const r of reminders) {
    const date = localDay(r.remindAt, tz);
    const daysLeft = daysBetween(today, date);
    items.push({
      kind: "REMINDER",
      date,
      time: localTime(r.remindAt, tz),
      daysLeft,
      overdue: daysLeft < 0,
      title: r.title,
      detail: r.message,
      link: { type: "Reminder", id: r.id },
    });
  }

  items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? "").localeCompare(b.time ?? "") ||
      a.title.localeCompare(b.title),
  );
  const byDay: Array<{ date: string; items: AgendaItem[] }> = [];
  for (let day = today; day <= until; day = nextDay(day)) {
    byDay.push({ date: day, items: items.filter((i) => i.date === day) });
  }
  return {
    today,
    until,
    overdue: items.filter((i) => i.overdue),
    days: byDay,
  };
}
