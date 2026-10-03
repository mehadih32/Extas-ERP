import { ReminderStatus, ReminderType, TaskPriority, TaskStatus } from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";
import { REPEAT_UNITS } from "@/modules/reminders/repeat";

const id = z.string().trim().min(1).max(64);
const ids = z
  .array(id)
  .max(50)
  .transform((list) => [...new Set(list)]);
const day = z.iso.date();
/** "09:30", 24 hours. */
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 hours)");
/** A calendar day (company time) or an exact timestamp. */
const dayOrInstant = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const take = z.coerce.number().int().min(1).max(100).default(30);
const cursor = z.string().min(1).max(64).optional();
const someField = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);

// --- Automatic reminder settings -----------------------------------------------------

export const updateRuleSchema = z
  .object({
    isActive: z.boolean().optional(),
    /** Days before the date to remind ([7, 3, 1, 0]); empty = only once it is overdue. */
    daysBefore: z.array(z.number().int().min(0).max(365)).max(10).optional(),
    /** Remind again every this many days once the date has passed (0 = never). */
    overdueEveryDays: z.number().int().min(0).max(90).optional(),
    sendTime: time.optional(),
    notifyManagers: z.boolean().optional(),
    notifyOwner: z.boolean().optional(),
    userIds: ids.optional(),
    employeeIds: ids.optional(),
  })
  .refine(someField, "Nothing to change");

// --- Reminders set by hand -----------------------------------------------------------

const repeatSchema = z.object({
  every: z.enum(REPEAT_UNITS),
  interval: z.number().int().min(1).max(365).default(1),
  /** The last day it may fire on. */
  until: day.optional(),
});

/** Records a reminder can point at (each must be in this company). */
const links = {
  projectId: id.nullish(),
  orderId: id.nullish(),
  purchaseOrderId: id.nullish(),
  complianceDocumentId: id.nullish(),
  taskId: id.nullish(),
};

const when = {
  /** An exact time ("2026-10-05T10:30:00+06:00")... */
  remindAt: z.iso.datetime({ offset: true }).optional(),
  /** ...or a day with a wall-clock time in company time (default 09:00). */
  day: day.optional(),
  time: time.optional(),
};

export const createReminderSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    message: z.string().trim().max(2000).nullish(),
    type: z.enum(ReminderType).default("CUSTOM"),
    ...when,
    repeat: repeatSchema.nullish(),
    /** Who hears about it. Without anyone, the reminder is for you. */
    userIds: ids.optional(),
    employeeIds: ids.optional(),
    ...links,
  })
  .superRefine((v, ctx) => {
    if (!v.remindAt && !v.day) {
      ctx.addIssue({ code: "custom", path: ["day"], message: "Pick when to remind" });
    }
    if (v.remindAt && (v.day || v.time)) {
      ctx.addIssue({
        code: "custom",
        path: ["remindAt"],
        message: "Give a time or a day, not both",
      });
    }
  });

export const updateReminderSchema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    message: z.string().trim().max(2000).nullish(),
    ...when,
    /** null stops it repeating. */
    repeat: repeatSchema.nullish(),
    userIds: ids.optional(),
    employeeIds: ids.optional(),
    ...links,
  })
  .refine(someField, "Nothing to change")
  .superRefine((v, ctx) => {
    if (v.remindAt && (v.day || v.time)) {
      ctx.addIssue({
        code: "custom",
        path: ["remindAt"],
        message: "Give a time or a day, not both",
      });
    }
    if (v.time && !v.day) {
      ctx.addIssue({ code: "custom", path: ["day"], message: "Pick the day too" });
    }
  });

export const listRemindersSchema = z.object({
  status: z.enum(ReminderStatus).optional(),
  type: z.enum(ReminderType).optional(),
  /** true: only automatic ones; false: only ones set by hand. */
  automatic: queryBoolean.optional(),
  /** Everyone's reminders (reminders.manage), not only yours. */
  all: queryBoolean.optional(),
  projectId: id.optional(),
  orderId: id.optional(),
  purchaseOrderId: id.optional(),
  complianceDocumentId: id.optional(),
  taskId: id.optional(),
  cursor,
  take,
});

export const upcomingSchema = z.object({
  /** How many days ahead, today included. */
  days: z.coerce.number().int().min(1).max(90).default(7),
});

// --- Tasks -----------------------------------------------------------------------------

export const createTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).nullish(),
  /** The employee doing it. */
  assigneeId: id.nullish(),
  projectId: id.nullish(),
  /** A day (company time) or an exact time ("factory visit Tuesday 10:00"). */
  dueAt: dayOrInstant.nullish(),
  priority: z.enum(TaskPriority).optional(),
});

export const updateTaskSchema = createTaskSchema.partial().refine(someField, "Nothing to change");

export const taskStatusSchema = z.object({ status: z.enum(TaskStatus) });

/** What an employee may do with their own task: start it, finish it, or reopen it. */
export const portalTaskStatusSchema = z.object({ status: z.enum(["TODO", "IN_PROGRESS", "DONE"]) });

export const listTasksSchema = z.object({
  status: z.enum(TaskStatus).optional(),
  /** Only tasks still to do or in progress. */
  open: queryBoolean.optional(),
  assigneeId: id.optional(),
  projectId: id.optional(),
  /** Only tasks you created. */
  mine: queryBoolean.optional(),
  /** Only open tasks whose due day has passed. */
  overdue: queryBoolean.optional(),
  /** Due between these days (company time). */
  from: day.optional(),
  to: day.optional(),
  search: z.string().trim().max(100).optional(),
  cursor,
  take,
});

// --- Notifications -------------------------------------------------------------------

export const listNotificationsSchema = z.object({
  unread: queryBoolean.optional(),
  cursor,
  take,
});
