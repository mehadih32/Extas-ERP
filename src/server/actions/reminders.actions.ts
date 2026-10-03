"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requireCompany, requirePermission } from "@/modules/auth/context";
import * as notifications from "@/modules/reminders/notification.service";
import * as reminders from "@/modules/reminders/reminder.service";
import * as rules from "@/modules/reminders/rules";
import * as tasks from "@/modules/reminders/task.service";

/*
 * Tasks, reminders and the in-app inbox Server Actions. Tasks and reminders for
 * other people need reminders.manage; anyone with the notepad can remind
 * themselves; everyone sees their own inbox and agenda. Automatic reminder
 * settings need company.settings. Each returns { ok: true, data } or
 * { ok: false, error }.
 */

const manager = () => requirePermission("reminders.manage");
const reminderUser = () => requireAnyPermission("notepad.use", "reminders.manage");

// Tasks
export const listTasksAction = async (query: unknown) =>
  runAction(async () => tasks.listTasks(await manager(), query));
export const getTaskAction = async (taskId: string) =>
  runAction(async () => tasks.getTask(await manager(), taskId));
export const createTaskAction = async (input: unknown) =>
  runAction(async () => tasks.createTask(await manager(), input, await getRequestMeta()));
export const updateTaskAction = async (taskId: string, input: unknown) =>
  runAction(async () => tasks.updateTask(await manager(), taskId, input, await getRequestMeta()));
export const setTaskStatusAction = async (taskId: string, input: unknown) =>
  runAction(async () =>
    tasks.setTaskStatus(await manager(), taskId, input, await getRequestMeta()),
  );
export const deleteTaskAction = async (taskId: string) =>
  runAction(async () => tasks.deleteTask(await manager(), taskId, await getRequestMeta()));

// Reminders
export const listRemindersAction = async (query: unknown) =>
  runAction(async () => reminders.listReminders(await requireCompany(), query));
export const getReminderAction = async (reminderId: string) =>
  runAction(async () => reminders.getReminder(await requireCompany(), reminderId));
export const createReminderAction = async (input: unknown) =>
  runAction(async () =>
    reminders.createReminder(await reminderUser(), input, await getRequestMeta()),
  );
export const updateReminderAction = async (reminderId: string, input: unknown) =>
  runAction(async () =>
    reminders.updateReminder(await reminderUser(), reminderId, input, await getRequestMeta()),
  );
export const cancelReminderAction = async (reminderId: string) =>
  runAction(async () =>
    reminders.cancelReminder(await reminderUser(), reminderId, await getRequestMeta()),
  );
export const deleteReminderAction = async (reminderId: string) =>
  runAction(async () =>
    reminders.deleteReminder(await reminderUser(), reminderId, await getRequestMeta()),
  );
export const acknowledgeReminderAction = async (reminderId: string) =>
  runAction(async () =>
    reminders.acknowledgeReminder(await requireCompany(), reminderId, await getRequestMeta()),
  );
export const upcomingAction = async (query: unknown = {}) =>
  runAction(async () => reminders.upcoming(await requireCompany(), query));

// Automatic reminder settings
export const listReminderRulesAction = async () =>
  runAction(async () =>
    rules.listRules(await requireAnyPermission("reminders.manage", "company.settings")),
  );
export const updateReminderRuleAction = async (type: string, input: unknown) =>
  runAction(async () =>
    rules.updateRule(
      await requirePermission("company.settings"),
      type,
      input,
      await getRequestMeta(),
    ),
  );

// Inbox
export const listNotificationsAction = async (query: unknown = {}) =>
  runAction(async () => notifications.listNotifications(await requireCompany(), query));
export const unreadNotificationsAction = async () =>
  runAction(async () => notifications.unreadCount(await requireCompany()));
export const markNotificationReadAction = async (notificationId: string) =>
  runAction(async () => notifications.markNotificationRead(await requireCompany(), notificationId));
export const markAllNotificationsReadAction = async () =>
  runAction(async () => notifications.markAllNotificationsRead(await requireCompany()));
