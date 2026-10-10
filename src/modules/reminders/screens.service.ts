import type { NoteTab, TaskStatus } from "@prisma/client";
import { z } from "zod";

import { localDay, localTime, startOfDayInZone } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { listNotes, type NoteView } from "@/modules/notepad/note.service";
import {
  type Acting,
  awaitsAcknowledging,
  canCancelReminder,
  canDeleteReminder,
  canEditReminder,
  canEditTask,
  plannerKeys,
  type ReminderState,
  taskMoves,
} from "@/modules/reminders/checks";
import { type RecordLink, recordHref } from "@/modules/reminders/links";
import { listNotifications } from "@/modules/reminders/notification.service";
import {
  getReminder,
  listReminders,
  reminderState,
  type ReminderView,
  upcoming,
} from "@/modules/reminders/reminder.service";
import { listRules } from "@/modules/reminders/rules";
import { getTask, listTasks, myTasks, type TaskView } from "@/modules/reminders/task.service";

/*
 * What the Planner screens (coming up, notepad, tasks, reminders, automatic
 * reminders), the inbox and the employee's own tasks in My HR show, with what
 * the person looking may do decided by the same keys and rules the services
 * use (reminders/checks.ts):
 *   notepad.use        their own notepad and reminders for themselves
 *   reminders.manage   tasks for staff, reminders for other people, everyone's
 *   company.settings   the automatic reminder settings
 *   portal.self        the tasks given to them
 * Records a reminder or message is about open where this person's role
 * opens them (links.ts).
 */

const OPEN_TASKS: TaskStatus[] = ["TODO", "IN_PROGRESS"];
const search = z.string().trim().max(100).catch("");

const acting = (ctx: CompanyContext): Acting => ({
  userId: ctx.user.id,
  manage: ctx.can("reminders.manage"),
});

const stateOf = (r: ReminderView): ReminderState => ({
  automatic: r.automatic,
  createdById: r.createdBy?.id ?? null,
  status: r.status,
  repeating: r.repeat !== null,
  sentAt: r.sentAt,
  acknowledgedAt: r.acknowledgedAt,
});

// --- Coming up ---------------------------------------------------------------------------

/** How many days the agenda covers, today included. */
export const AGENDA_SPANS = [7, 14, 30] as const;

export function agendaSpan(raw: unknown): (typeof AGENDA_SPANS)[number] {
  const n = Number(raw);
  return AGENDA_SPANS.find((s) => s === n) ?? 7;
}

/**
 * Everything coming up for this person in the next days and what is overdue
 * (as far as their role lets them see it), each item with the page it opens.
 */
export async function getAgendaScreen(
  ctx: CompanyContext,
  raw: { days?: unknown } = {},
  now: Date = new Date(),
) {
  const span = agendaSpan(raw.days);
  const agenda = await upcoming(ctx, { days: span }, now);
  const withHref = <T extends { link: RecordLink }>(item: T) => ({
    ...item,
    href: recordHref(ctx, item.link),
  });
  const keys = plannerKeys(ctx);
  return {
    today: agenda.today,
    until: agenda.until,
    span,
    overdue: agenda.overdue.map(withHref),
    days: agenda.days.map((d) => ({ date: d.date, items: d.items.map(withHref) })),
    can: { remind: keys.remind, task: keys.manage },
  };
}

export type AgendaScreen = Awaited<ReturnType<typeof getAgendaScreen>>;
export type AgendaRow = AgendaScreen["overdue"][number];

// --- Notepad -----------------------------------------------------------------------------

export const NOTE_TABS: readonly NoteTab[] = ["DAILY_ROUTINE", "NEXT_3_DAYS", "GENERAL"];

export type NotepadScreen =
  | { tab: "DAILY_ROUTINE"; today: string; items: NoteView[]; done: number }
  | {
      tab: "NEXT_3_DAYS";
      today: string;
      overdue: NoteView[];
      days: Array<{ date: string; items: NoteView[] }>;
    }
  | { tab: "GENERAL"; today: string; items: NoteView[]; search: string };

/** One tab of the person's own notepad (notepad.use). */
export async function getNotepadScreen(
  ctx: CompanyContext,
  raw: { tab?: unknown; search?: unknown } = {},
  now: Date = new Date(),
): Promise<NotepadScreen> {
  const tab = NOTE_TABS.find((t) => t === raw.tab) ?? "DAILY_ROUTINE";
  const words = tab === "GENERAL" ? search.parse(raw.search ?? "") : "";
  const list = await listNotes(ctx, { tab, ...(words ? { search: words } : {}) }, now);
  if ("days" in list) {
    return {
      tab: "NEXT_3_DAYS",
      today: list.date,
      overdue: list.overdue ?? [],
      days: list.days ?? [],
    };
  }
  if (tab === "DAILY_ROUTINE") {
    return {
      tab,
      today: list.date,
      items: list.items,
      done: list.items.filter((i) => i.done).length,
    };
  }
  return { tab: "GENERAL", today: list.date, items: list.items, search: words };
}

// --- Tasks -------------------------------------------------------------------------------

/** Every task (reminders.manage), with how many are open and overdue. */
export async function getTasksScreen(
  ctx: CompanyContext,
  raw: { assigneeId?: string } & Record<string, unknown> = {},
  now: Date = new Date(),
) {
  const tz = ctx.company.timezone;
  const startOfToday = startOfDayInZone(localDay(now, tz), tz);
  const [page, open, overdue, assignee] = await Promise.all([
    listTasks(ctx, raw, now),
    ctx.db.task.count({ where: { status: { in: OPEN_TASKS } } }),
    ctx.db.task.count({ where: { status: { in: OPEN_TASKS }, dueAt: { lt: startOfToday } } }),
    typeof raw.assigneeId === "string"
      ? ctx.db.employee.findUnique({
          where: { id: raw.assigneeId },
          select: { id: true, code: true, name: true },
        })
      : null,
  ]);
  return { ...page, counts: { open, overdue }, assignee };
}

export type TaskRow = TaskView;

/** One task with what may be done with it, and the reminders sent about it. */
export async function getTaskScreen(ctx: CompanyContext, taskId: string, now: Date = new Date()) {
  const task = await getTask(ctx, taskId, now);
  const reminders = await listReminders(ctx, { all: true, taskId, take: 20 });
  return {
    task,
    /** The employee's and the project's pages, when this person's role opens them. */
    links: {
      assignee: task.assignee ? recordHref(ctx, { type: "Employee", id: task.assignee.id }) : null,
      project: task.project
        ? recordHref(ctx, { type: "ProductionProject", id: task.project.id })
        : null,
    },
    moves: taskMoves(task.status, true),
    can: { edit: canEditTask(task).ok, delete: true },
    reminders: reminders.items.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      automatic: r.automatic,
      day: r.day,
      time: r.time,
      sentAt: r.sentAt,
    })),
  };
}

export type TaskScreen = Awaited<ReturnType<typeof getTaskScreen>>;

// --- Reminders ---------------------------------------------------------------------------

function reminderRow(r: ReminderView) {
  return { ...r, awaits: awaitsAcknowledging(stateOf(r)) };
}

export type ReminderRow = ReturnType<typeof reminderRow>;

/** The person's reminders (everyone's with `all` and reminders.manage), latest first. */
export async function listReminderRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listReminders(ctx, raw);
  return { items: page.items.map(reminderRow), nextCursor: page.nextCursor };
}

export async function getRemindersScreen(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listReminderRows(ctx, raw);
  const keys = plannerKeys(ctx);
  return { ...page, can: { add: keys.remind, everyone: keys.manage, others: keys.manage } };
}

/** One reminder with the records it is about and what may be done with it. */
export async function getReminderScreen(ctx: CompanyContext, reminderId: string) {
  const reminder = await getReminder(ctx, reminderId);
  const state = stateOf(reminder);
  const me = acting(ctx);
  const { project, order, purchaseOrder, complianceDocument, task } = reminder.links;
  const about = [
    project && {
      label: `Project ${project.code} ${project.name}`,
      href: recordHref(ctx, { type: "ProductionProject", id: project.id }),
    },
    order && {
      label: `Order ${order.number}`,
      href: recordHref(ctx, { type: "SalesOrder", id: order.id }),
    },
    purchaseOrder && {
      label: `Purchase order ${purchaseOrder.number}`,
      href: recordHref(ctx, { type: "PurchaseOrder", id: purchaseOrder.id }),
    },
    complianceDocument && {
      label: `${complianceDocument.title}${complianceDocument.number ? ` ${complianceDocument.number}` : ""}`,
      href: recordHref(ctx, { type: "ComplianceDocument", id: complianceDocument.id }),
    },
    task && { label: `Task: ${task.title}`, href: recordHref(ctx, { type: "Task", id: task.id }) },
  ].filter((x): x is { label: string; href: string | null } => Boolean(x));
  // Changing a reminder also needs the notepad or reminders.manage (the actions' own check).
  const remind = plannerKeys(ctx).remind;
  return {
    reminder,
    about,
    can: {
      edit: remind && canEditReminder(state, me).ok,
      cancel: remind && canCancelReminder(state, me).ok,
      delete: remind && canDeleteReminder(state, me).ok,
      acknowledge: awaitsAcknowledging(state),
      others: me.manage,
    },
  };
}

export type ReminderScreen = Awaited<ReturnType<typeof getReminderScreen>>;

// --- Automatic reminders -----------------------------------------------------------------

/** The automatic reminder settings, with the names of the extra people told. */
export async function getRulesScreen(ctx: CompanyContext) {
  const rules = await listRules(ctx);
  const userIds = [...new Set(rules.flatMap((r) => r.userIds))];
  const employeeIds = [...new Set(rules.flatMap((r) => r.employeeIds))];
  const [users, staff] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [],
    employeeIds.length
      ? ctx.db.employee.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, code: true, name: true, userId: true },
        })
      : [],
  ]);
  return {
    rules: rules.map((r) => ({
      ...r,
      people: [
        ...users
          .filter((u) => r.userIds.includes(u.id))
          .map((u) => ({ kind: "user" as const, id: u.id, name: u.name })),
        ...staff
          .filter((e) => r.employeeIds.includes(e.id))
          .map((e) => ({
            kind: "employee" as const,
            id: e.id,
            name: e.name,
            /** Without a login they are told once WhatsApp is set up. */
            ...(e.userId ? {} : { note: "no login yet" }),
          })),
      ],
    })),
    can: { edit: ctx.can("company.settings") },
  };
}

export type RulesScreen = Awaited<ReturnType<typeof getRulesScreen>>;
export type RuleRow = RulesScreen["rules"][number];

// --- Inbox -------------------------------------------------------------------------------

async function inboxRows(
  ctx: CompanyContext,
  items: Awaited<ReturnType<typeof listNotifications>>["items"],
) {
  const ids = [...new Set(items.flatMap((n) => (n.reminderId ? [n.reminderId] : [])))];
  const reminders = ids.length
    ? await ctx.db.reminder.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          sourceKey: true,
          createdById: true,
          status: true,
          repeatRule: true,
          sentAt: true,
          acknowledgedAt: true,
        },
      })
    : [];
  const byId = new Map(reminders.map((r) => [r.id, r]));
  const tz = ctx.company.timezone;
  return items.map((n) => {
    const reminder = n.reminderId ? byId.get(n.reminderId) : undefined;
    return {
      ...n,
      /** When it came, in company time. */
      day: localDay(n.createdAt, tz),
      time: localTime(n.createdAt, tz),
      href: recordHref(ctx, n.link),
      /** The reminder it came from still waits to be dealt with. */
      dealtWith: reminder ? !awaitsAcknowledging(reminderState(reminder)) : true,
    };
  });
}

/** The person's messages, newest first, with how many are unread. */
export async function getInboxScreen(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listNotifications(ctx, raw);
  return { ...page, items: await inboxRows(ctx, page.items) };
}

export async function listInboxRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listNotifications(ctx, raw);
  return { items: await inboxRows(ctx, page.items), nextCursor: page.nextCursor };
}

export type InboxRow = Awaited<ReturnType<typeof listInboxRows>>["items"][number];

// --- My tasks (My HR) --------------------------------------------------------------------

export const MY_TASK_SHOWS = ["open", "done", "all"] as const;
export type MyTaskShow = (typeof MY_TASK_SHOWS)[number];

const myTaskQuery = (show: MyTaskShow) =>
  show === "done" ? { status: "DONE" } : show === "all" ? { open: false } : {};

function myTaskRow(task: TaskView) {
  return { ...task, moves: taskMoves(task.status, false) };
}

export type MyTaskRow = ReturnType<typeof myTaskRow>;

/** The tasks given to the signed-in employee (portal.self): open ones first by due day. */
export async function getMyTasksScreen(
  ctx: CompanyContext,
  raw: { show?: unknown; cursor?: string } = {},
  now: Date = new Date(),
) {
  const show = MY_TASK_SHOWS.find((s) => s === raw.show) ?? "open";
  const page = await myTasks(
    ctx,
    { ...myTaskQuery(show), ...(raw.cursor ? { cursor: raw.cursor } : {}) },
    now,
  );
  return { show, items: page.items.map(myTaskRow), nextCursor: page.nextCursor };
}

// --- Pickers -----------------------------------------------------------------------------

export type PersonOption = {
  /** "user:…" or "employee:…" (unique in a list). */
  id: string;
  kind: "user" | "employee";
  personId: string;
  name: string;
  detail: string;
};

/**
 * People a reminder can go to: the company's active users, and staff who have
 * no login yet (they are told once WhatsApp is set up, so the app keeps them).
 */
export async function findPeople(ctx: CompanyContext, raw: unknown): Promise<PersonOption[]> {
  const text = search.parse(raw ?? "");
  const [members, staff] = await Promise.all([
    prisma.companyMembership.findMany({
      where: {
        companyId: ctx.company.id,
        isActive: true,
        user: {
          status: { not: "SUSPENDED" },
          ...(text
            ? {
                OR: [
                  { name: { contains: text, mode: "insensitive" } },
                  { email: { contains: text, mode: "insensitive" } },
                ],
              }
            : {}),
        },
      },
      select: { user: { select: { id: true, name: true } }, role: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
      take: 10,
    }),
    ctx.db.employee.findMany({
      where: {
        userId: null,
        status: { in: ["ACTIVE", "ON_LEAVE"] },
        ...(text
          ? {
              OR: [
                { name: { contains: text, mode: "insensitive" } },
                { code: { contains: text, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
      take: 10,
    }),
  ]);
  return [
    ...members.map((m) => ({
      id: `user:${m.user.id}`,
      kind: "user" as const,
      personId: m.user.id,
      name: m.user.name,
      detail: m.role.name,
    })),
    ...staff.map((e) => ({
      id: `employee:${e.id}`,
      kind: "employee" as const,
      personId: e.id,
      name: e.name,
      detail: `${e.code} · no login yet`,
    })),
  ];
}

export type EmployeeOption = {
  id: string;
  code: string;
  name: string;
  designation: string | null;
  hasLogin: boolean;
};

/** Current staff a task can be given to (reminders.manage). */
export async function findTaskEmployees(
  ctx: CompanyContext,
  raw: unknown,
): Promise<EmployeeOption[]> {
  const text = search.parse(raw ?? "");
  const rows = await ctx.db.employee.findMany({
    where: {
      status: { in: ["ACTIVE", "ON_LEAVE"] },
      ...(text
        ? {
            OR: [
              { name: { contains: text, mode: "insensitive" } },
              { code: { contains: text, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, code: true, name: true, designation: true, userId: true },
    orderBy: { name: "asc" },
    take: 12,
  });
  return rows.map(({ userId, ...e }) => ({ ...e, hasLogin: userId !== null }));
}

export type ProjectOption = { id: string; code: string; name: string };

/** Production projects not finished or cancelled, newest first, a task can belong to. */
export async function findTaskProjects(
  ctx: CompanyContext,
  raw: unknown,
): Promise<ProjectOption[]> {
  const text = search.parse(raw ?? "");
  return ctx.db.productionProject.findMany({
    where: {
      status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] },
      ...(text
        ? {
            OR: [
              { name: { contains: text, mode: "insensitive" } },
              { code: { contains: text, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, code: true, name: true },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
}
