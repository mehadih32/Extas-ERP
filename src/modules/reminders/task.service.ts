import { type Prisma, type TaskStatus } from "@prisma/client";

import { localDay, localTime, nextDay, startOfDayInZone, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { requireLinkedEmployee } from "@/modules/hr/access";
import { isActiveMember } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";
import { settleAlerts } from "@/modules/reminders/reminder.service";
import {
  createTaskSchema,
  listTasksSchema,
  portalTaskStatusSchema,
  taskStatusSchema,
  updateTaskSchema,
} from "@/modules/reminders/schemas";

/*
 * In-app task tracking (blueprint section 7): management gives staff a piece of
 * work ("Nazrul: factory visit on Tuesday 10:00"), with a due day or time, a
 * priority and, if it belongs to one, a production project. The assignee hears
 * about it in the app through the login linked to their employee profile, sees
 * it in the employee portal and marks it started or done there; whoever created
 * it hears when it is done. Reminders before the due date come from the
 * TASK_DUE rule (rules.ts).
 *
 *   reminders.manage   create, assign, edit, cancel and see every task
 *   portal.self        the tasks assigned to you: start, finish or reopen them
 */

type Tx = Prisma.TransactionClient;

const OPEN: TaskStatus[] = ["TODO", "IN_PROGRESS"];

const taskInclude = {
  assignee: { select: { id: true, code: true, name: true, userId: true } },
  project: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

const STATUS_WORDS: Record<TaskStatus, string> = {
  TODO: "to do",
  IN_PROGRESS: "in progress",
  DONE: "done",
  CANCELLED: "cancelled",
};

function dueParts(dueAt: Date | null, timeZone: string) {
  if (!dueAt) return { dueDay: null, dueTime: null };
  const time = localTime(dueAt, timeZone);
  return { dueDay: localDay(dueAt, timeZone), dueTime: time === "00:00" ? null : time };
}

function present(task: TaskRow, timeZone: string, today: string) {
  const { dueDay, dueTime } = dueParts(task.dueAt, timeZone);
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    /** The due day in company time, and the time when one was set ("10:30"). */
    dueDay,
    dueTime,
    overdue: OPEN.includes(task.status) && dueDay !== null && dueDay < today,
    assignee: task.assignee
      ? {
          id: task.assignee.id,
          code: task.assignee.code,
          name: task.assignee.name,
          /** False when they have no login yet, so in-app messages cannot reach them. */
          hasLogin: task.assignee.userId !== null,
        }
      : null,
    project: task.project,
    createdBy: task.createdBy,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export type TaskView = ReturnType<typeof present>;

const today = (ctx: CompanyContext, now: Date) => localDay(now, ctx.company.timezone);

function dueText(task: { dueAt: Date | null }, timeZone: string): string {
  const { dueDay, dueTime } = dueParts(task.dueAt, timeZone);
  return dueDay ? `, due ${formatDay(dueDay)}${dueTime ? ` ${dueTime}` : ""}` : "";
}

async function loadTask(ctx: CompanyContext, taskId: string): Promise<TaskRow> {
  const task = await ctx.db.task.findUnique({ where: { id: taskId }, include: taskInclude });
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  return task;
}

async function checkRefs(
  ctx: CompanyContext,
  input: { assigneeId?: string | null; projectId?: string | null },
) {
  if (input.assigneeId) {
    const employee = await ctx.db.employee.findUnique({ where: { id: input.assigneeId } });
    if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
    if (employee.status === "RESIGNED" || employee.status === "TERMINATED") {
      throw new AppError("VALIDATION", `${employee.name} no longer works here.`, {
        assigneeId: ["Pick a current employee"],
      });
    }
  }
  if (input.projectId) {
    const project = await ctx.db.productionProject.findUnique({ where: { id: input.projectId } });
    if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  }
}

/** Tells a user in the app, unless they are the one acting or no longer in the company. */
async function tell(
  tx: Tx,
  ctx: CompanyContext,
  userId: string | null | undefined,
  employeeId: string | null,
  message: { subject: string; body: string },
  taskId: string,
  now: Date,
) {
  if (!userId || userId === ctx.user.id) return;
  if (!(await isActiveMember(ctx.company.id, userId, tx))) return;
  await sendInApp(
    tx,
    ctx.company.id,
    [{ userId, employeeId }],
    { ...message, entityType: "Task", entityId: taskId },
    now,
  );
}

async function tellAssignee(tx: Tx, ctx: CompanyContext, task: TaskRow, now: Date) {
  if (!task.assignee) return;
  await tell(
    tx,
    ctx,
    task.assignee.userId,
    task.assignee.id,
    {
      subject: `New task: ${task.title}`,
      body: `${ctx.user.name} gave you a task${dueText(task, ctx.company.timezone)}.${
        task.description ? ` ${task.description}` : ""
      }`,
    },
    task.id,
    now,
  );
}

export async function createTask(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const input = createTaskSchema.parse(raw);
  await checkRefs(ctx, input);
  const tz = ctx.company.timezone;
  const created = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        companyId: ctx.company.id,
        title: input.title,
        description: input.description || null,
        assigneeId: input.assigneeId ?? null,
        projectId: input.projectId ?? null,
        dueAt: input.dueAt ? toInstant(input.dueAt, tz) : null,
        priority: input.priority ?? "MEDIUM",
        createdById: ctx.user.id,
      },
      include: taskInclude,
    });
    await tellAssignee(tx, ctx, task, now);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Task",
        entityId: task.id,
        summary: `Task "${task.title}"${task.assignee ? ` for ${task.assignee.name}` : ""}${dueText(task, tz)}`,
      },
      tx,
    );
    return task;
  });
  return present(created, tz, today(ctx, now));
}

/** Edits an open task; a new assignee hears about it. */
export async function updateTask(
  ctx: CompanyContext,
  taskId: string,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const input = updateTaskSchema.parse(raw);
  const task = await loadTask(ctx, taskId);
  if (!OPEN.includes(task.status)) {
    throw new AppError(
      "CONFLICT",
      `This task is ${STATUS_WORDS[task.status]}. Reopen it before changing it.`,
    );
  }
  await checkRefs(ctx, input);
  const tz = ctx.company.timezone;
  const reassigned = input.assigneeId !== undefined && input.assigneeId !== task.assigneeId;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.task.update({
      where: { id: task.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.dueAt !== undefined
          ? { dueAt: input.dueAt ? toInstant(input.dueAt, tz) : null }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      },
      include: taskInclude,
    });
    if (reassigned) await tellAssignee(tx, ctx, row, now);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Task",
        entityId: task.id,
        summary: `Edited task "${row.title}": ${Object.keys(input).join(", ")}`,
      },
      tx,
    );
    return row;
  });
  return present(updated, tz, today(ctx, now));
}

async function changeStatus(
  ctx: CompanyContext,
  task: TaskRow,
  status: TaskStatus,
  meta: RequestMeta | undefined,
  now: Date,
) {
  if (task.status === status) {
    throw new AppError("CONFLICT", `This task is already ${STATUS_WORDS[status]}.`);
  }
  const tz = ctx.company.timezone;
  return prisma.$transaction(async (tx) => {
    // Only the change from the status read above goes through (no double "done" messages).
    const { count } = await tx.task.updateMany({
      where: { id: task.id, companyId: ctx.company.id, status: task.status },
      data: { status, completedAt: status === "DONE" ? now : null },
    });
    if (count === 0) {
      throw new AppError(
        "CONFLICT",
        "This task was just changed by someone else. Refresh and try again.",
      );
    }
    if (status === "DONE") {
      await tell(
        tx,
        ctx,
        task.createdById,
        null,
        {
          subject: `Task done: ${task.title}`,
          body: `${task.assignee && task.assignee.userId === ctx.user.id ? task.assignee.name : ctx.user.name} finished "${task.title}".`,
        },
        task.id,
        now,
      );
    }
    if (status === "DONE" || status === "CANCELLED") {
      await settleAlerts(tx, ctx.company.id, { taskId: task.id }, ctx.user.id, now);
    }
    if (status === "CANCELLED" && task.assignee) {
      await tell(
        tx,
        ctx,
        task.assignee.userId,
        task.assignee.id,
        { subject: `Task cancelled: ${task.title}`, body: `${ctx.user.name} cancelled this task.` },
        task.id,
        now,
      );
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Task",
        entityId: task.id,
        summary: `Task "${task.title}": ${STATUS_WORDS[task.status]} -> ${STATUS_WORDS[status]}`,
      },
      tx,
    );
    const row = await tx.task.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude });
    return present(row, tz, localDay(now, tz));
  });
}

/** Any status change by management (reminders.manage), including cancelling and reopening. */
export async function setTaskStatus(
  ctx: CompanyContext,
  taskId: string,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const { status } = taskStatusSchema.parse(raw);
  return changeStatus(ctx, await loadTask(ctx, taskId), status, meta, now);
}

export async function deleteTask(ctx: CompanyContext, taskId: string, meta?: RequestMeta) {
  const task = await loadTask(ctx, taskId);
  await prisma.$transaction(async (tx) => {
    await tx.task.delete({ where: { id: task.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "Task",
        entityId: task.id,
        summary: `Deleted task "${task.title}"`,
      },
      tx,
    );
  });
  return { id: task.id, deleted: true };
}

export async function getTask(ctx: CompanyContext, taskId: string, now: Date = new Date()) {
  return present(await loadTask(ctx, taskId), ctx.company.timezone, today(ctx, now));
}

function listWhere(
  ctx: CompanyContext,
  input: ReturnType<typeof listTasksSchema.parse>,
  now: Date,
): Prisma.TaskWhereInput {
  const tz = ctx.company.timezone;
  const startOfToday = startOfDayInZone(today(ctx, now), tz);
  const and: Prisma.TaskWhereInput[] = [];
  if (input.status) and.push({ status: input.status });
  if (input.open || input.overdue) and.push({ status: { in: OPEN } });
  if (input.overdue) and.push({ dueAt: { lt: startOfToday } });
  if (input.assigneeId) and.push({ assigneeId: input.assigneeId });
  if (input.projectId) and.push({ projectId: input.projectId });
  if (input.mine) and.push({ createdById: ctx.user.id });
  if (input.from) and.push({ dueAt: { gte: startOfDayInZone(input.from, tz) } });
  if (input.to) and.push({ dueAt: { lt: startOfDayInZone(nextDay(input.to), tz) } });
  if (input.search) {
    and.push({
      OR: [
        { title: { contains: input.search, mode: "insensitive" } },
        { description: { contains: input.search, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

async function page(
  ctx: CompanyContext,
  where: Prisma.TaskWhereInput,
  input: { cursor?: string; take: number },
  now: Date,
) {
  const rows = await ctx.db.task.findMany({
    where,
    include: taskInclude,
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
    take: input.take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > input.take;
  const items = hasMore ? rows.slice(0, input.take) : rows;
  return {
    items: items.map((t) => present(t, ctx.company.timezone, today(ctx, now))),
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  };
}

/** Every task in the company (management), soonest due first. */
export async function listTasks(ctx: CompanyContext, raw: unknown = {}, now: Date = new Date()) {
  const input = listTasksSchema.parse(raw);
  return page(ctx, listWhere(ctx, input, now), input, now);
}

// --- Employee portal --------------------------------------------------------------------

/** The tasks assigned to the signed-in employee (open ones unless a status is asked for). */
export async function myTasks(ctx: CompanyContext, raw: unknown = {}, now: Date = new Date()) {
  const input = listTasksSchema.parse(raw);
  const employee = await requireLinkedEmployee(ctx);
  const where = listWhere(
    ctx,
    {
      ...input,
      assigneeId: undefined,
      mine: undefined,
      open: input.status ? input.open : (input.open ?? true),
    },
    now,
  );
  return page(ctx, { AND: [where, { assigneeId: employee.id }] }, input, now);
}

/** An employee starts, finishes or reopens a task assigned to them. */
export async function setMyTaskStatus(
  ctx: CompanyContext,
  taskId: string,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const { status } = portalTaskStatusSchema.parse(raw);
  const employee = await requireLinkedEmployee(ctx);
  const task = await ctx.db.task.findFirst({
    where: { id: taskId, assigneeId: employee.id },
    include: taskInclude,
  });
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  if (task.status === "CANCELLED") {
    throw new AppError("CONFLICT", "This task was cancelled.");
  }
  return changeStatus(ctx, task, status, meta, now);
}
