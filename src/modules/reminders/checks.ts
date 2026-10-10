import type { ReminderStatus, TaskStatus } from "@prisma/client";

import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * What may be done with a reminder or a task from where it stands, and who may
 * do it. The reminder and task services refuse with these answers and the
 * Planner screens read the same answers to decide what to offer.
 */

type Can = { can: (permission: PermissionKey) => boolean };

/**
 * The planner keys a person holds, and what they add up to:
 *   notepad   notepad.use: their own notepad, reminders for themselves
 *   manage    reminders.manage: tasks for staff, reminders for other people,
 *             everyone's reminders and tasks
 *   settings  company.settings: changes the automatic reminders
 *   rules     sees the automatic reminder settings
 *   remind    sets reminders (for themselves, or others with manage)
 *   self      portal.self: the tasks given to them, in My HR
 */
export function plannerKeys(ctx: Can) {
  const notepad = ctx.can("notepad.use");
  const manage = ctx.can("reminders.manage");
  const settings = ctx.can("company.settings");
  return {
    notepad,
    manage,
    settings,
    rules: manage || settings,
    remind: notepad || manage,
    self: ctx.can("portal.self"),
  };
}

export type PlannerKeys = ReturnType<typeof plannerKeys>;

// --- Reminders ---------------------------------------------------------------------------

export type ReminderState = {
  /** Made by an automatic rule (it has a source key). */
  automatic: boolean;
  createdById: string | null;
  status: ReminderStatus;
  /** It has a repeat rule. */
  repeating: boolean;
  /** When it last went out. */
  sentAt: Date | null;
  acknowledgedAt: Date | null;
};

/** The person acting, for the rule about one's own reminders. */
export type Acting = { userId: string; manage: boolean };

/** A reminder set by hand is changed by its maker, or by reminders.manage. */
export function canChangeReminder(reminder: ReminderState, me: Acting): Verdict {
  if (reminder.automatic) {
    return refuse("CONFLICT", "Automatic reminders follow their record; change its date instead.");
  }
  if (reminder.createdById !== me.userId && !me.manage) {
    return refuse("FORBIDDEN", "Only the person who set this reminder can change it.");
  }
  return ALLOWED;
}

/** Editing is for reminders that have not gone out yet. */
export function canEditReminder(reminder: ReminderState, me: Acting): Verdict {
  const change = canChangeReminder(reminder, me);
  if (!change.ok) return change;
  if (reminder.status !== "SCHEDULED") {
    return refuse("CONFLICT", "This reminder has already gone out or was cancelled.");
  }
  return ALLOWED;
}

export function canCancelReminder(reminder: ReminderState, me: Acting): Verdict {
  const change = canChangeReminder(reminder, me);
  if (!change.ok) return change;
  if (reminder.status !== "SCHEDULED") {
    return refuse("CONFLICT", "Only reminders that have not gone out can be cancelled.");
  }
  return ALLOWED;
}

export function canDeleteReminder(reminder: ReminderState, me: Acting): Verdict {
  return canChangeReminder(reminder, me);
}

/**
 * Marking a reminder as dealt with: once it has gone out. A repeating one stays
 * scheduled for its next time, so it counts once it has gone out at least once.
 */
export function canAcknowledgeReminder(reminder: ReminderState): Verdict {
  if (reminder.status === "SENT" || reminder.status === "ACKNOWLEDGED") return ALLOWED;
  if (reminder.status === "SCHEDULED" && reminder.repeating && reminder.sentAt !== null) {
    return ALLOWED;
  }
  return refuse("CONFLICT", "Only reminders that have gone out can be marked as dealt with.");
}

/** Whether the time it last went out is still to be dealt with (what the screens offer). */
export function awaitsAcknowledging(reminder: ReminderState): boolean {
  if (!canAcknowledgeReminder(reminder).ok || reminder.status === "ACKNOWLEDGED") return false;
  if (reminder.status === "SENT") return true;
  return (
    reminder.sentAt !== null &&
    (reminder.acknowledgedAt === null || reminder.acknowledgedAt < reminder.sentAt)
  );
}

// --- Tasks -------------------------------------------------------------------------------

export const TASK_STATUS_WORDS: Record<TaskStatus, string> = {
  TODO: "to do",
  IN_PROGRESS: "in progress",
  DONE: "done",
  CANCELLED: "cancelled",
};

const OPEN: readonly TaskStatus[] = ["TODO", "IN_PROGRESS"];

export const isOpenTask = (status: TaskStatus) => OPEN.includes(status);

/** Editing is for open tasks; a done or cancelled one is reopened first. */
export function canEditTask(task: { status: TaskStatus }): Verdict {
  if (!isOpenTask(task.status)) {
    return refuse(
      "CONFLICT",
      `This task is ${TASK_STATUS_WORDS[task.status]}. Reopen it before changing it.`,
    );
  }
  return ALLOWED;
}

/** Management (reminders.manage) may move a task to any other status. */
export function canSetTaskStatus(task: { status: TaskStatus }, to: TaskStatus): Verdict {
  if (task.status === to) {
    return refuse("CONFLICT", `This task is already ${TASK_STATUS_WORDS[to]}.`);
  }
  return ALLOWED;
}

/** What an employee may do with a task given to them: start it, finish it or reopen it. */
export const MY_TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;

export function canSetMyTaskStatus(task: { status: TaskStatus }, to: TaskStatus): Verdict {
  if (task.status === "CANCELLED") return refuse("CONFLICT", "This task was cancelled.");
  if (!(MY_TASK_STATUSES as readonly TaskStatus[]).includes(to)) {
    return refuse("FORBIDDEN", "Only the person who gave you this task can cancel it.");
  }
  return canSetTaskStatus(task, to);
}

/**
 * The status changes the screens offer from where a task stands, in the order
 * of the buttons: start or finish an open task, take a started one back to
 * "to do", cancel it (management only), reopen a finished or cancelled one.
 */
export function taskMoves(status: TaskStatus, management: boolean): TaskStatus[] {
  const moves: TaskStatus[] =
    status === "TODO"
      ? ["IN_PROGRESS", "DONE", "CANCELLED"]
      : status === "IN_PROGRESS"
        ? ["DONE", "TODO", "CANCELLED"]
        : ["TODO"];
  return moves.filter((to) =>
    management ? canSetTaskStatus({ status }, to).ok : canSetMyTaskStatus({ status }, to).ok,
  );
}
