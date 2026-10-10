"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requireCompany, requirePermission } from "@/modules/auth/context";
import * as notifications from "@/modules/reminders/notification.service";
import * as reminders from "@/modules/reminders/reminder.service";
import * as rules from "@/modules/reminders/rules";
import * as screens from "@/modules/reminders/screens.service";
import * as tasks from "@/modules/reminders/task.service";

/*
 * Tasks, reminders and the in-app inbox Server Actions. Tasks and reminders for
 * other people need reminders.manage; anyone with the notepad can remind
 * themselves; everyone sees their own inbox and agenda. Automatic reminder
 * settings need company.settings. Each returns { ok: true, data } or
 * { ok: false, error }. Changes refresh the screens and hand back the record's
 * id (and title and status) only.
 */

const manager = () => requirePermission("reminders.manage");
const reminderUser = () => requireAnyPermission("notepad.use", "reminders.manage");
const ruleReader = () => requireAnyPermission("reminders.manage", "company.settings");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

const taskRef = (t: { id: string; title: string; status: string }) => ({
  id: t.id,
  title: t.title,
  status: t.status,
});
const reminderRef = (r: {
  id: string;
  title: string;
  status: string;
  day: string;
  time: string;
}) => ({
  id: r.id,
  title: r.title,
  status: r.status,
  day: r.day,
  time: r.time,
});

// --- Screens -------------------------------------------------------------------------------
export const getAgendaScreenAction = async (query: { days?: unknown } = {}) =>
  runAction(async () => screens.getAgendaScreen(await requireCompany(), query));
export const getTasksScreenAction = async (query: Record<string, unknown> = {}) =>
  runAction(async () => screens.getTasksScreen(await manager(), query));
export const listTaskRowsAction = async (query: unknown) =>
  runAction(async () => tasks.listTasks(await manager(), query));
export const getTaskScreenAction = async (taskId: string) =>
  runAction(async () => screens.getTaskScreen(await manager(), taskId));
export const getRemindersScreenAction = async (query: unknown = {}) =>
  runAction(async () => screens.getRemindersScreen(await requireCompany(), query));
export const listReminderRowsAction = async (query: unknown) =>
  runAction(async () => screens.listReminderRows(await requireCompany(), query));
export const getReminderScreenAction = async (reminderId: string) =>
  runAction(async () => screens.getReminderScreen(await requireCompany(), reminderId));
export const getRulesScreenAction = async () =>
  runAction(async () => screens.getRulesScreen(await ruleReader()));
export const getInboxScreenAction = async (query: unknown = {}) =>
  runAction(async () => screens.getInboxScreen(await requireCompany(), query));
export const listInboxRowsAction = async (query: unknown) =>
  runAction(async () => screens.listInboxRows(await requireCompany(), query));

/** People a reminder (or an automatic reminder) can also go to. */
export const findPeopleAction = async (text: string) =>
  runAction(async () => screens.findPeople(await ruleReader(), text));
/** Staff a task can be given to. */
export const findTaskEmployeesAction = async (text: string) =>
  runAction(async () => screens.findTaskEmployees(await manager(), text));
/** Production projects a task can belong to. */
export const findTaskProjectsAction = async (text: string) =>
  runAction(async () => screens.findTaskProjects(await manager(), text));

// --- Tasks ---------------------------------------------------------------------------------
export const listTasksAction = async (query: unknown) =>
  runAction(async () => tasks.listTasks(await manager(), query));
export const getTaskAction = async (taskId: string) =>
  runAction(async () => tasks.getTask(await manager(), taskId));
export const createTaskAction = async (input: unknown) =>
  change(async () =>
    taskRef(await tasks.createTask(await manager(), input, await getRequestMeta())),
  );
export const updateTaskAction = async (taskId: string, input: unknown) =>
  change(async () =>
    taskRef(await tasks.updateTask(await manager(), taskId, input, await getRequestMeta())),
  );
export const setTaskStatusAction = async (taskId: string, input: unknown) =>
  change(async () =>
    taskRef(await tasks.setTaskStatus(await manager(), taskId, input, await getRequestMeta())),
  );
export const deleteTaskAction = async (taskId: string) =>
  change(async () => tasks.deleteTask(await manager(), taskId, await getRequestMeta()));

// --- Reminders -----------------------------------------------------------------------------
export const listRemindersAction = async (query: unknown) =>
  runAction(async () => reminders.listReminders(await requireCompany(), query));
export const getReminderAction = async (reminderId: string) =>
  runAction(async () => reminders.getReminder(await requireCompany(), reminderId));
export const createReminderAction = async (input: unknown) =>
  change(async () =>
    reminderRef(
      await reminders.createReminder(await reminderUser(), input, await getRequestMeta()),
    ),
  );
export const updateReminderAction = async (reminderId: string, input: unknown) =>
  change(async () =>
    reminderRef(
      await reminders.updateReminder(
        await reminderUser(),
        reminderId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const cancelReminderAction = async (reminderId: string) =>
  change(async () =>
    reminderRef(
      await reminders.cancelReminder(await reminderUser(), reminderId, await getRequestMeta()),
    ),
  );
export const deleteReminderAction = async (reminderId: string) =>
  change(async () =>
    reminders.deleteReminder(await reminderUser(), reminderId, await getRequestMeta()),
  );
export const acknowledgeReminderAction = async (reminderId: string) =>
  change(async () =>
    reminderRef(
      await reminders.acknowledgeReminder(
        await requireCompany(),
        reminderId,
        await getRequestMeta(),
      ),
    ),
  );
export const upcomingAction = async (query: unknown = {}) =>
  runAction(async () => reminders.upcoming(await requireCompany(), query));

// --- Automatic reminder settings -----------------------------------------------------------
export const listReminderRulesAction = async () =>
  runAction(async () => rules.listRules(await ruleReader()));
export const updateReminderRuleAction = async (type: string, input: unknown) =>
  change(async () => {
    const rule = await rules.updateRule(
      await requirePermission("company.settings"),
      type,
      input,
      await getRequestMeta(),
    );
    return { type: rule.type, label: rule.label, isActive: rule.isActive };
  });

// --- Inbox ---------------------------------------------------------------------------------
export const listNotificationsAction = async (query: unknown = {}) =>
  runAction(async () => notifications.listNotifications(await requireCompany(), query));
export const unreadNotificationsAction = async () =>
  runAction(async () => notifications.unreadCount(await requireCompany()));
export const markNotificationReadAction = async (notificationId: string) =>
  change(async () => {
    const message = await notifications.markNotificationRead(
      await requireCompany(),
      notificationId,
    );
    return { id: message.id, read: message.read };
  });
export const markAllNotificationsReadAction = async () =>
  change(async () => notifications.markAllNotificationsRead(await requireCompany()));
